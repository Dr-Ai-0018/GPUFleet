"""Tests for task lifecycle: create, claim, complete, lost detection."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "test-node-1") -> dict:
    """Helper to create a node and return the response."""
    resp = client.post("/api/v1/admin/nodes", headers=auth_headers, json={
        "node_id": node_id,
        "display_name": f"Test Node {node_id}",
        "node_type": "physical",
        "os_type": "linux",
        "heartbeat_interval_sec": 5,
        "allowed_workdirs": ["/tmp/work"],
        "allow_shell": True,
    })
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _create_task(
    client: TestClient,
    auth_headers: dict[str, str],
    node_id: str = "test-node-1",
    task_type: str = "health_check",
    payload: dict | None = None,
    timeout_sec: int | None = None,
) -> dict:
    """Helper to create a task."""
    body = {
        "node_id": node_id,
        "type": task_type,
        "payload": payload or ({} if task_type == "health_check" else {"command": "echo hello"}),
        "workdir": "/tmp/work",
    }
    if timeout_sec is not None:
        body["timeout_sec"] = timeout_sec
    resp = client.post("/api/v1/admin/tasks", headers=auth_headers, json=body)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


class TestTaskCreate:
    def test_create_task_success(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers)
        task = _create_task(client, auth_headers)
        assert task["status"] == "pending"
        assert task["type"] == "health_check"
        assert task["node_id"] == "test-node-1"

    def test_create_task_invalid_type(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers)
        resp = client.post("/api/v1/admin/tasks", headers=auth_headers, json={
            "node_id": "test-node-1",
            "type": "nonexistent_type",
            "payload": {},
        })
        assert resp.status_code == 422

    def test_create_task_node_not_found(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        resp = client.post("/api/v1/admin/tasks", headers=auth_headers, json={
            "node_id": "nonexistent-node",
            "type": "shell",
            "payload": {"command": "echo hi"},
        })
        assert resp.status_code in (404, 422)


class TestTaskLifecycle:
    def test_task_claim_on_heartbeat(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """A pending task should be claimed when the node heartbeats."""
        node_data = _create_node(client, auth_headers)
        task = _create_task(client, auth_headers)

        # Simulate heartbeat from node
        from app.security import build_signed_headers_for_test

        heartbeat_payload = {
            "boot_id": "boot-001",
            "heartbeat_interval_sec": 5,
        }
        body = json.dumps(heartbeat_payload).encode()
        headers = build_signed_headers_for_test(
            node_id="test-node-1",
            node_secret=node_data["node_secret"],
            body=body,
        )
        resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
        assert resp.status_code == 200, resp.text
        hb_data = resp.json()
        assert len(hb_data["tasks"]) == 1
        assert hb_data["tasks"][0]["task_id"] == task["task_id"]

        # Verify task is now claimed
        resp = client.get(f"/api/v1/admin/tasks/{task['task_id']}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "claimed"

    def test_task_cancel(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers)
        task = _create_task(client, auth_headers)

        resp = client.post(f"/api/v1/admin/tasks/{task['task_id']}/cancel", headers=auth_headers)
        assert resp.status_code == 200
        # Pending tasks are directly cancelled (no node ack needed)
        # Claimed/running tasks would become cancel_requested
        assert resp.json()["status"] in ("cancelled", "cancel_requested")


class TestTaskLostDetection:
    def test_mark_lost_when_node_unresponsive(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """Tasks on unresponsive nodes should be marked lost."""
        node_data = _create_node(client, auth_headers)
        task = _create_task(client, auth_headers)

        # Heartbeat to claim the task
        heartbeat_payload = {"boot_id": "boot-001", "heartbeat_interval_sec": 5}
        body = json.dumps(heartbeat_payload).encode()
        from app.security import build_signed_headers_for_test
        headers = build_signed_headers_for_test("test-node-1", node_data["node_secret"], body)
        resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
        assert resp.status_code == 200

        # Now simulate time passing (node hasn't heartbeated for > 3x interval)
        from app.config import get_settings
        from app.db import Database
        settings = get_settings()
        db = Database(settings.database_path)

        # Set last_seen_at to 20 seconds ago (> 3 * 5s interval)
        old_time = (datetime.now(UTC) - timedelta(seconds=20)).replace(microsecond=0).isoformat()
        with db.connect() as conn:
            conn.execute("UPDATE nodes SET last_seen_at = ? WHERE node_id = ?", (old_time, "test-node-1"))

        # Run the lost task scanner
        from app.background import _mark_lost_tasks
        _mark_lost_tasks(db)

        # Verify task is now lost
        resp = client.get(f"/api/v1/admin/tasks/{task['task_id']}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "lost"

    def test_mark_timeout_when_exceeded(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """Running tasks past their timeout should be marked timeout."""
        # 副作用: 创建节点入库 (任务调度需要), 返回值未使用
        _create_node(client, auth_headers)

        # Create task with short timeout
        task = _create_task(client, auth_headers, timeout_sec=10)

        from app.config import get_settings
        from app.db import Database
        settings = get_settings()
        db = Database(settings.database_path)

        # Manually set task to running with started_at in the past
        old_start = (datetime.now(UTC) - timedelta(seconds=30)).replace(microsecond=0).isoformat()
        now_iso = datetime.now(UTC).replace(microsecond=0).isoformat()
        with db.connect() as conn:
            conn.execute(
                "UPDATE tasks SET status = 'running', started_at = ?, claimed_at = ? WHERE task_id = ?",
                (old_start, now_iso, task["task_id"]),
            )
            # Ensure node has recent heartbeat so it's not marked lost first
            conn.execute("UPDATE nodes SET last_seen_at = ? WHERE node_id = ?", (now_iso, "test-node-1"))

        # Run the lost task scanner
        from app.background import _mark_lost_tasks
        _mark_lost_tasks(db)

        # Verify task is now timeout
        resp = client.get(f"/api/v1/admin/tasks/{task['task_id']}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "timeout"

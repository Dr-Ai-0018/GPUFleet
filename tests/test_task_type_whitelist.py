"""Tests for §1.5 Phase A task type whitelist and reviewing skeleton."""

from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.security import build_signed_headers_for_test


def _create_node(
    client: TestClient,
    auth_headers: dict[str, str],
    *,
    node_id: str,
    allow_shell: bool = False,
    allow_modal: bool = False,
) -> dict[str, object]:
    resp = client.post(
        "/api/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": f"Node {node_id}",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "tags": [],
            "allow_shell": allow_shell,
            "allow_modal": allow_modal,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _heartbeat(node_id: str, node_secret: str) -> tuple[int, dict[str, object]]:
    payload = {"boot_id": "boot-001", "heartbeat_interval_sec": 5}
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test(node_id, node_secret, body)
    with TestClient(app) as thread_client:
        resp = thread_client.post("/api/node/heartbeat", content=body, headers=headers)
    return resp.status_code, resp.json()


class TestTaskTypeWhitelistPhaseA:
    def test_l0_health_check_goes_pending(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers, node_id="l0-node")
        resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "l0-node",
                "type": "health_check",
                "payload": {},
                "workdir": "/tmp/work",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "pending"

    def test_l1_git_pull_goes_pending(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers, node_id="l1-node")
        resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "l1-node",
                "type": "git_pull",
                "payload": {"remote": "origin"},
                "workdir": "/tmp/work",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "pending"

    def test_l2_shell_without_permission_returns_403(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers, node_id="l2-no-shell")
        resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "l2-no-shell",
                "type": "shell",
                "payload": {"command": "echo blocked"},
                "workdir": "/tmp/work",
            },
        )
        assert resp.status_code == 403
        assert "allow_shell" in resp.json()["detail"]

    def test_l2_shell_with_permission_enters_reviewing(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers, node_id="l2-shell", allow_shell=True)
        resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "l2-shell",
                "type": "shell",
                "payload": {"command": "echo review"},
                "workdir": "/tmp/work",
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "reviewing"
        assert data["review_stage"] == 3
        assert data["review_decision"] == "pending_human"

    def test_reviewing_task_is_not_claimed_on_heartbeat(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        node = _create_node(client, auth_headers, node_id="review-node", allow_shell=True)
        resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "review-node",
                "type": "shell",
                "payload": {"command": "echo review"},
                "workdir": "/tmp/work",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "reviewing"

        status_code, body = _heartbeat("review-node", node["node_secret"])
        assert status_code == 200
        assert body["tasks"] == []

    def test_reviewing_task_creates_alert_message(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers, node_id="alert-node", allow_shell=True)
        resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "alert-node",
                "type": "shell",
                "payload": {"command": "echo review"},
                "workdir": "/tmp/work",
            },
        )
        assert resp.status_code == 201, resp.text
        task_id = resp.json()["task_id"]

        settings = get_settings()
        with sqlite3.connect(settings.database_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT alert_type, severity, target_id, status
                FROM alert_messages
                WHERE target_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (task_id,),
            ).fetchone()

        assert row is not None
        assert row["alert_type"] == "command_review"
        assert row["severity"] == "critical"
        assert row["target_id"] == task_id
        assert row["status"] == "unread"

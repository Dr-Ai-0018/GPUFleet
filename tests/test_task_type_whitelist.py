"""Tests for §1.5 Phase A task type whitelist and reviewing skeleton."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import Database
from app.background import _expire_reviewing_tasks
from app.main import app
from app.review import ReviewDecision
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
        assert resp.json()["code"] == "ERR_TASK_TYPE_FORBIDDEN_ON_NODE"
        assert "allow_shell" in resp.json()["message"]

    def test_l2_shell_with_permission_without_api_key_enters_stage3_reviewing(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        _create_node(client, auth_headers, node_id="l2-shell", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = ""
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
        assert data["review_decision"] == "skipped"

    def test_reviewing_task_is_not_claimed_on_heartbeat(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        node = _create_node(client, auth_headers, node_id="review-node", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = ""
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
        settings = get_settings()
        settings.review_llm_api_key = ""
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

    def test_l2_shell_with_ai_approve_goes_pending(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        monkeypatch,
    ) -> None:
        _create_node(client, auth_headers, node_id="ai-approve-node", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = "test-key"

        async def fake_review(self, context):
            return ReviewDecision(decision="approve", risk_score=0.4, reasoning="可以执行")

        monkeypatch.setattr("app.review.LLMReviewer.review", fake_review)

        resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "ai-approve-node",
                "type": "shell",
                "payload": {"command": "echo safe"},
                "workdir": "/tmp/work",
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "pending"
        assert data["danger_level"] == "elevated"
        assert data["review_stage"] == 1
        assert data["review_decision"] == "approve"

    def test_escalate_review_moves_stage1_to_stage3(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        monkeypatch,
    ) -> None:
        _create_node(client, auth_headers, node_id="escalate-node", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = "test-key"

        async def fake_review(self, context):
            return ReviewDecision(decision="reject", risk_score=0.9, reasoning="高风险")

        monkeypatch.setattr("app.review.LLMReviewer.review", fake_review)

        create_resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "escalate-node",
                "type": "shell",
                "payload": {"command": "rm -rf /tmp/foo"},
                "workdir": "/tmp/work",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        task_id = create_resp.json()["task_id"]
        assert create_resp.json()["review_stage"] == 1

        escalate_resp = client.post(
            f"/api/admin/tasks/{task_id}/review/escalate",
            headers=auth_headers,
            json={"note": "需要人工确认"},
        )
        assert escalate_resp.status_code == 200, escalate_resp.text
        assert escalate_resp.json()["status"] == "reviewing"
        assert escalate_resp.json()["review_stage"] == 3
        assert escalate_resp.json()["review_decision"] == "pending_human"

    def test_approve_review_enforces_cooldown(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        _create_node(client, auth_headers, node_id="cooldown-node", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = ""
        create_resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "cooldown-node",
                "type": "shell",
                "payload": {"command": "echo review"},
                "workdir": "/tmp/work",
            },
        )
        task_id = create_resp.json()["task_id"]
        approve_resp = client.post(
            f"/api/admin/tasks/{task_id}/review/approve",
            headers=auth_headers,
            json={"note": "太快了"},
        )
        assert approve_resp.status_code == 429

    def test_approve_review_success_after_cooldown(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        _create_node(client, auth_headers, node_id="approve-node", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = ""
        create_resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "approve-node",
                "type": "shell",
                "payload": {"command": "echo review"},
                "workdir": "/tmp/work",
            },
        )
        task_id = create_resp.json()["task_id"]
        old_iso = (datetime.now(UTC) - timedelta(seconds=11)).replace(microsecond=0).isoformat()
        db = Database(settings.database_path)
        with db.connect() as conn:
            conn.execute("UPDATE tasks SET review_started_at = ? WHERE task_id = ?", (old_iso, task_id))

        approve_resp = client.post(
            f"/api/admin/tasks/{task_id}/review/approve",
            headers=auth_headers,
            json={"note": "人工批准"},
        )
        assert approve_resp.status_code == 200, approve_resp.text
        data = approve_resp.json()
        assert data["status"] == "pending"
        assert data["danger_level"] == "human_approved"
        assert data["review_decision"] == "human_approved"

    def test_reject_review_marks_task_rejected(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        _create_node(client, auth_headers, node_id="reject-node", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = ""
        create_resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "reject-node",
                "type": "shell",
                "payload": {"command": "echo review"},
                "workdir": "/tmp/work",
            },
        )
        task_id = create_resp.json()["task_id"]
        reject_resp = client.post(
            f"/api/admin/tasks/{task_id}/review/reject",
            headers=auth_headers,
            json={"note": "拒绝"},
        )
        assert reject_resp.status_code == 200, reject_resp.text
        assert reject_resp.json()["status"] == "rejected"
        assert reject_resp.json()["review_decision"] == "human_rejected"

    def test_review_expired_after_timeout_scan(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        _create_node(client, auth_headers, node_id="expired-node", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = ""
        create_resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "expired-node",
                "type": "shell",
                "payload": {"command": "echo review"},
                "workdir": "/tmp/work",
            },
        )
        task_id = create_resp.json()["task_id"]
        db = Database(settings.database_path)
        old_iso = (datetime.now(UTC) - timedelta(minutes=31)).replace(microsecond=0).isoformat()
        with db.connect() as conn:
            conn.execute("UPDATE tasks SET review_started_at = ? WHERE task_id = ?", (old_iso, task_id))

        _expire_reviewing_tasks(db)

        task_resp = client.get(f"/api/admin/tasks/{task_id}", headers=auth_headers)
        assert task_resp.status_code == 200
        assert task_resp.json()["status"] == "review_expired"

    def test_alert_unread_count_and_mark_read(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        _create_node(client, auth_headers, node_id="alerts-node", allow_shell=True)
        settings = get_settings()
        settings.review_llm_api_key = ""
        create_resp = client.post(
            "/api/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "alerts-node",
                "type": "shell",
                "payload": {"command": "echo review"},
                "workdir": "/tmp/work",
            },
        )
        task_id = create_resp.json()["task_id"]

        unread_resp = client.get("/api/admin/alerts/unread-count", headers=auth_headers)
        assert unread_resp.status_code == 200
        assert unread_resp.json()["unread_count"] > 0

        list_resp = client.get("/api/admin/alerts?status=unread", headers=auth_headers)
        assert list_resp.status_code == 200
        alerts = list_resp.json()
        target_alert = next(item for item in alerts if item["target_id"] == task_id)

        read_resp = client.post(f"/api/admin/alerts/{target_alert['id']}/read", headers=auth_headers)
        assert read_resp.status_code == 200
        assert read_resp.json()["status"] == "read"

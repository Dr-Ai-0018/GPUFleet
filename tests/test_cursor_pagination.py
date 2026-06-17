"""Cursor pagination and server-side filters for admin list endpoints."""

from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient

from app.config import get_settings


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str) -> None:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": node_id,
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "allow_shell": True,
        },
    )
    assert resp.status_code == 201, resp.text


def _create_task(client: TestClient, auth_headers: dict[str, str], node_id: str, task_id: str, task_type: str) -> None:
    resp = client.post(
        "/api/v1/admin/tasks",
        headers=auth_headers,
        json={
            "task_id": task_id,
            "node_id": node_id,
            "type": task_type,
            "payload": {} if task_type == "health_check" else {"command": "echo hi"},
            "workdir": "/tmp/work",
        },
    )
    assert resp.status_code == 201, resp.text


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().database_path)
    conn.row_factory = sqlite3.Row
    return conn


def test_tasks_cursor_page_and_filters(client: TestClient, auth_headers: dict[str, str]) -> None:
    _create_node(client, auth_headers, "node-a")
    _create_node(client, auth_headers, "node-b")
    _create_task(client, auth_headers, "node-a", "task-old", "health_check")
    _create_task(client, auth_headers, "node-a", "task-mid", "shell")
    _create_task(client, auth_headers, "node-b", "task-new", "health_check")

    with _db() as conn:
        conn.execute("UPDATE tasks SET created_at = ?, status = ? WHERE task_id = ?", ("2026-06-16T10:00:00+00:00", "succeeded", "task-old"))
        conn.execute("UPDATE tasks SET created_at = ?, status = ? WHERE task_id = ?", ("2026-06-16T11:00:00+00:00", "running", "task-mid"))
        conn.execute("UPDATE tasks SET created_at = ?, status = ? WHERE task_id = ?", ("2026-06-16T12:00:00+00:00", "pending", "task-new"))
        conn.commit()

    first = client.get("/api/v1/admin/tasks?limit=2", headers=auth_headers)
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert [item["task_id"] for item in first_body["items"]] == ["task-new", "task-mid"]
    assert first_body["next_cursor"]
    assert first_body["total_estimate"] == 3

    second = client.get(f"/api/v1/admin/tasks?limit=2&cursor={first_body['next_cursor']}", headers=auth_headers)
    assert second.status_code == 200, second.text
    assert [item["task_id"] for item in second.json()["items"]] == ["task-old"]
    assert second.json()["next_cursor"] is None

    filtered = client.get(
        "/api/v1/admin/tasks?node_id=node-a&type=shell&status=running"
        "&since=2026-06-16T10:30:00%2B00:00&until=2026-06-16T11:30:00%2B00:00",
        headers=auth_headers,
    )
    assert filtered.status_code == 200, filtered.text
    assert [item["task_id"] for item in filtered.json()["items"]] == ["task-mid"]


def test_invalid_cursor_returns_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    resp = client.get("/api/v1/admin/tasks?cursor=not-a-valid-cursor", headers=auth_headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == "ERR_VALIDATION_INVALID_CURSOR"


def test_audits_and_warnings_page_endpoints(client: TestClient, auth_headers: dict[str, str]) -> None:
    with _db() as conn:
        conn.executemany(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("admin", "1", "create_task", "task", "task-a", "127.0.0.1", json.dumps({"n": 1}), "2026-06-16T10:00:00+00:00"),
                ("node", "node-a", "heartbeat", "node", "node-a", None, json.dumps({"n": 2}), "2026-06-16T11:00:00+00:00"),
                ("admin", "1", "cancel_task", "task", "task-b", "127.0.0.1", json.dumps({"n": 3}), "2026-06-16T12:00:00+00:00"),
            ],
        )
        conn.executemany(
            """
            INSERT INTO security_warnings (source_type, source_id, warning_type, command_excerpt, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                ("task", "task-a", "dangerous_command", "rm -rf", json.dumps({"n": 1}), "2026-06-16T10:00:00+00:00"),
                ("task", "task-b", "path_escape", "../x", json.dumps({"n": 2}), "2026-06-16T11:00:00+00:00"),
            ],
        )
        conn.commit()

    audits = client.get("/api/v1/admin/audits?limit=2&actor_type=admin&target_type=task", headers=auth_headers)
    assert audits.status_code == 200, audits.text
    audit_body = audits.json()
    assert [item["action"] for item in audit_body["items"]] == ["cancel_task", "create_task"]
    assert audit_body["total_estimate"] == 2

    warnings = client.get("/api/v1/admin/warnings?warning_type=path_escape&source_type=task", headers=auth_headers)
    assert warnings.status_code == 200, warnings.text
    warning_body = warnings.json()
    assert [item["source_id"] for item in warning_body["items"]] == ["task-b"]
    assert warning_body["total_estimate"] == 1


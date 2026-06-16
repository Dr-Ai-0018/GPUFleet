"""Tests for task log rotation and storage quota enforcement."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.config import get_settings
from app.security import build_signed_headers_for_test


def _create_node_and_task(client: TestClient, auth_headers: dict[str, str]) -> tuple[str, str]:
    node_resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": "log-node",
            "display_name": "Log Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "allow_shell": True,
        },
    )
    assert node_resp.status_code == 201, node_resp.text
    task_resp = client.post(
        "/api/v1/admin/tasks",
        headers=auth_headers,
        json={
            "node_id": "log-node",
            "type": "health_check",
            "payload": {},
            "workdir": "/tmp/work",
        },
    )
    assert task_resp.status_code == 201, task_resp.text
    return node_resp.json()["node_secret"], task_resp.json()["task_id"]


def test_large_log_chunk_rotates_to_gzip_archive(client: TestClient, auth_headers: dict[str, str]) -> None:
    settings = get_settings()
    settings.task_log_stream_max_bytes = 128
    settings.storage_quota_bytes = 1024 * 1024
    node_secret, task_id = _create_node_and_task(client, auth_headers)

    payload = {
        "task_id": task_id,
        "stream": "stdout",
        "offset_start": 0,
        "text": "a" * 400,
        "is_final": False,
    }
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test("log-node", node_secret, body)
    resp = client.post("/api/v1/node/task-log-chunk", content=body, headers=headers)
    assert resp.status_code == 200, resp.text

    log_dir = settings.storage_path / "logs" / task_id
    archives = sorted(log_dir.glob("stdout.*.log.gz"))
    active_log = log_dir / "stdout.log"
    assert archives, "expected at least one rotated gzip archive"
    assert active_log.exists()
    assert active_log.stat().st_size <= settings.task_log_stream_max_bytes

    logs_resp = client.get(f"/api/v1/admin/tasks/{task_id}/logs", headers=auth_headers)
    assert logs_resp.status_code == 200
    assert logs_resp.json()[0]["is_truncated"] is False


def test_storage_quota_rejects_new_log_chunk_and_marks_truncated(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    settings = get_settings()
    settings.task_log_stream_max_bytes = 1024
    settings.storage_quota_bytes = 10
    node_secret, task_id = _create_node_and_task(client, auth_headers)

    payload = {
        "task_id": task_id,
        "stream": "stdout",
        "offset_start": 0,
        "text": "quota-hit-log",
        "is_final": False,
    }
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test("log-node", node_secret, body)
    resp = client.post("/api/v1/node/task-log-chunk", content=body, headers=headers)
    assert resp.status_code == 507

    logs_resp = client.get(f"/api/v1/admin/tasks/{task_id}/logs", headers=auth_headers)
    assert logs_resp.status_code == 200
    assert logs_resp.json()[0]["is_truncated"] is True
    assert logs_resp.json()[0]["truncated_notice"] == "storage_quota_exceeded"

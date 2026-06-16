"""Tests for task result idempotency and result locking."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import Database, utc_now_iso
from app.main import app
from app.security import build_signed_headers_for_test, derive_node_signing_key


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "result-node") -> dict[str, object]:
    resp = client.post(
        "/api/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Result Node",
        "node_type": "physical",
        "os_type": "linux",
        "heartbeat_interval_sec": 5,
        "allowed_workdirs": ["/tmp/work"],
        "tags": [],
        "allow_shell": True,
    },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_task(client: TestClient, auth_headers: dict[str, str], *, node_id: str, task_id: str) -> dict[str, object]:
    resp = client.post(
        "/api/admin/tasks",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "type": "health_check",
            "payload": {},
            "task_id": task_id,
            "workdir": "/tmp/work",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _set_task_status(task_id: str, status: str) -> None:
    settings = get_settings()
    db = Database(settings.database_path)
    now_iso = utc_now_iso()
    with db.connect() as conn:
        conn.execute(
            """
            UPDATE tasks
            SET status = ?, claimed_at = COALESCE(claimed_at, ?), started_at = COALESCE(started_at, ?)
            WHERE task_id = ?
            """,
            (status, now_iso, now_iso, task_id),
        )


def _signed_result_headers(node_id: str, node_secret: str, body: bytes, timestamp: str) -> dict[str, str]:
    headers = build_signed_headers_for_test(node_id, node_secret, body)
    signing_key = derive_node_signing_key(node_secret)
    body_hash = hashlib.sha256(body).hexdigest()
    headers["X-Timestamp"] = timestamp
    message = "\n".join([node_id, timestamp, headers["X-Nonce"], body_hash]).encode("utf-8")
    headers["X-Signature"] = hmac.new(signing_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return headers


class TestTaskResultIdempotency:
    def test_duplicate_result_returns_consistent_duplicate_response(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node = _create_node(client, auth_headers, node_id="duplicate-result-node")
        task = _create_task(client, auth_headers, node_id="duplicate-result-node", task_id="result-task-1")
        _set_task_status(task["task_id"], "running")

        payload = {
            "task_id": task["task_id"],
            "final_status": "succeeded",
            "exit_code": 0,
            "summary": {"message": "ok"},
        }
        body = json.dumps(payload).encode("utf-8")
        first_headers = _signed_result_headers(
            node["node_id"],
            node["node_secret"],
            body,
            datetime.now(UTC).replace(microsecond=0).isoformat(),
        )
        first = client.post("/api/node/task-result", content=body, headers=first_headers)
        assert first.status_code == 200, first.text
        assert first.json()["status"] == "succeeded"

        duplicate_responses = []
        base_time = datetime.now(UTC).replace(microsecond=0)
        for offset in range(1, 6):
            headers = _signed_result_headers(
                node["node_id"],
                node["node_secret"],
                body,
                (base_time + timedelta(seconds=offset)).isoformat(),
            )
            resp = client.post("/api/node/task-result", content=body, headers=headers)
            assert resp.status_code == 200, resp.text
            duplicate_responses.append(resp.json())

        assert all(item["duplicate"] is True for item in duplicate_responses)
        assert all(item["status"] == "succeeded" for item in duplicate_responses)

    def test_concurrent_conflicting_results_only_one_wins(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node = _create_node(client, auth_headers, node_id="conflict-result-node")
        task = _create_task(client, auth_headers, node_id="conflict-result-node", task_id="result-task-2")
        _set_task_status(task["task_id"], "running")
        base_time = datetime.now(UTC).replace(microsecond=0)

        def submit_result(final_status: str, offset: int) -> tuple[int, dict[str, object]]:
            payload = {
                "task_id": task["task_id"],
                "final_status": final_status,
                "exit_code": 0 if final_status == "succeeded" else 1,
                "summary": {"final_status": final_status},
            }
            body = json.dumps(payload).encode("utf-8")
            headers = _signed_result_headers(
                node["node_id"],
                node["node_secret"],
                body,
                (base_time + timedelta(seconds=offset)).isoformat(),
            )
            with TestClient(app) as thread_client:
                resp = thread_client.post("/api/node/task-result", content=body, headers=headers)
            return resp.status_code, resp.json()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda args: submit_result(*args), [("succeeded", 0), ("failed", 1)]))

        statuses = [body["status"] for status_code, body in results if status_code == 200]
        assert len(statuses) >= 1
        assert len(statuses) <= 2

        non_success = [(status_code, body) for status_code, body in results if status_code != 200]
        if non_success:
            assert len(non_success) == 1
            assert non_success[0][0] == 409
            assert non_success[0][1]["code"] == "ERR_AUTH_TIMESTAMP_REPLAY"
            assert non_success[0][1]["message"] == "Timestamp must be strictly increasing"
        else:
            assert any(body.get("duplicate") is True for _, body in results)

        settings = get_settings()
        with sqlite3.connect(settings.database_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT status, result_locked_at FROM tasks WHERE task_id = ?",
                (task["task_id"],),
            ).fetchone()

        assert row is not None
        assert row["status"] in {"succeeded", "failed"}
        assert row["result_locked_at"] is not None
        assert row["status"] in statuses

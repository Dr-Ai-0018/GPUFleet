"""Concurrency and ordering tests for task claim on heartbeat."""

from __future__ import annotations

import hashlib
import hmac
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import Database
from app.main import app
from app.security import build_signed_headers_for_test, derive_node_signing_key


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "claim-node") -> dict[str, object]:
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
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_task(
    client: TestClient,
    auth_headers: dict[str, str],
    *,
    node_id: str,
    task_id: str,
    command: str = "echo hello",
) -> dict[str, object]:
    resp = client.post(
        "/api/admin/tasks",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "type": "shell",
            "payload": {"command": command},
            "task_id": task_id,
            "workdir": "/tmp/work",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _heartbeat(
    node_id: str,
    node_secret: str,
    *,
    active_task_id: str | None = None,
    timestamp: str | None = None,
) -> tuple[int, dict[str, object]]:
    payload = {
        "boot_id": "boot-001",
        "heartbeat_interval_sec": 5,
        "task_runtime": {"active_task_id": active_task_id},
    }
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test(node_id, node_secret, body)
    if timestamp is not None:
        signing_key = derive_node_signing_key(node_secret)
        body_hash = hashlib.sha256(body).hexdigest()
        headers["X-Timestamp"] = timestamp
        message = "\n".join([node_id, timestamp, headers["X-Nonce"], body_hash]).encode("utf-8")
        headers["X-Signature"] = hmac.new(signing_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
    with TestClient(app) as thread_client:
        resp = thread_client.post("/api/node/heartbeat", content=body, headers=headers)
    return resp.status_code, resp.json()


class TestTaskClaimConcurrency:
    def test_only_one_concurrent_heartbeat_claims_single_pending_task(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node = _create_node(client, auth_headers, node_id="claim-race-node")
        task = _create_task(
            client,
            auth_headers,
            node_id="claim-race-node",
            task_id="race-task-1",
        )
        barrier = Barrier(10)
        base_time = datetime.now(UTC).replace(microsecond=0)

        def send_heartbeat(index: int) -> tuple[int, dict[str, object]]:
            barrier.wait()
            return _heartbeat(
                "claim-race-node",
                node["node_secret"],
                timestamp=(base_time + timedelta(seconds=index)).isoformat(),
            )

        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(send_heartbeat, range(10)))

        claimed_responses = [
            body
            for status_code, body in results
            if status_code == 200 and len(body["tasks"]) == 1
        ]

        assert len(claimed_responses) == 1
        assert claimed_responses[0]["tasks"][0]["task_id"] == task["task_id"]

        settings = get_settings()
        db = Database(settings.database_path)
        with db.connect() as conn:
            rows = conn.execute(
                """
                SELECT task_id, status
                FROM tasks
                WHERE node_id = ?
                ORDER BY id ASC
                """,
                ("claim-race-node",),
            ).fetchall()

        assert len(rows) == 1
        assert rows[0]["task_id"] == task["task_id"]
        assert rows[0]["status"] == "claimed"

    def test_node_with_active_task_does_not_claim_new_pending_task(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node = _create_node(client, auth_headers, node_id="active-node")
        first_task = _create_task(client, auth_headers, node_id="active-node", task_id="active-task-1")
        second_task = _create_task(client, auth_headers, node_id="active-node", task_id="active-task-2")
        base_time = datetime.now(UTC).replace(microsecond=0)

        first_status, first_body = _heartbeat(
            "active-node",
            node["node_secret"],
            timestamp=base_time.isoformat(),
        )
        assert first_status == 200
        assert len(first_body["tasks"]) == 1
        assert first_body["tasks"][0]["task_id"] == first_task["task_id"]

        second_status, second_body = _heartbeat(
            "active-node",
            node["node_secret"],
            active_task_id=first_task["task_id"],
            timestamp=(base_time + timedelta(seconds=1)).isoformat(),
        )
        assert second_status == 200
        assert second_body["tasks"] == []

        settings = get_settings()
        db = Database(settings.database_path)
        with db.connect() as conn:
            statuses = {
                row["task_id"]: row["status"]
                for row in conn.execute(
                    "SELECT task_id, status FROM tasks WHERE node_id = ?",
                    ("active-node",),
                ).fetchall()
            }

        assert statuses[first_task["task_id"]] == "claimed"
        assert statuses[second_task["task_id"]] == "pending"

    def test_multiple_pending_tasks_are_claimed_in_created_order(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node = _create_node(client, auth_headers, node_id="ordered-node")
        first_task = _create_task(client, auth_headers, node_id="ordered-node", task_id="ordered-task-1")
        second_task = _create_task(client, auth_headers, node_id="ordered-node", task_id="ordered-task-2")
        third_task = _create_task(client, auth_headers, node_id="ordered-node", task_id="ordered-task-3")

        claimed_task_ids: list[str] = []
        settings = get_settings()
        db = Database(settings.database_path)
        base_time = datetime.now(UTC).replace(microsecond=0)

        for offset, expected_task_id in enumerate([first_task["task_id"], second_task["task_id"], third_task["task_id"]]):
            timestamp = (base_time + timedelta(seconds=offset)).isoformat()
            status_code, body = _heartbeat("ordered-node", node["node_secret"], timestamp=timestamp)
            assert status_code == 200
            assert len(body["tasks"]) == 1
            claimed_task_id = body["tasks"][0]["task_id"]
            claimed_task_ids.append(claimed_task_id)
            assert claimed_task_id == expected_task_id

            with db.connect() as conn:
                conn.execute(
                    "UPDATE tasks SET status = 'succeeded', finished_at = ? WHERE task_id = ?",
                    ("2026-05-25T00:00:00+00:00", claimed_task_id),
                )

        assert claimed_task_ids == [
            first_task["task_id"],
            second_task["task_id"],
            third_task["task_id"],
        ]

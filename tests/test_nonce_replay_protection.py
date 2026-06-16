"""Tests for nonce replay protection and monotonic timestamps."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from threading import Barrier

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import Database
from app.main import app
from app.security import build_signed_headers_for_test, derive_node_signing_key


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "replay-node") -> dict[str, object]:
    resp = client.post(
        "/api/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Replay Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "tags": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestNonceReplayProtection:
    def test_duplicate_nonce_is_rejected(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        node = _create_node(client, auth_headers)
        payload = {"boot_id": "boot-001", "heartbeat_interval_sec": 5}
        body = json.dumps(payload).encode("utf-8")
        headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)

        first = client.post("/api/node/heartbeat", content=body, headers=headers)
        assert first.status_code == 200, first.text

        next_timestamp = (datetime.fromisoformat(headers["X-Timestamp"]) + timedelta(seconds=1)).isoformat()
        reused_nonce = headers["X-Nonce"]
        signing_key = derive_node_signing_key(node["node_secret"])
        body_hash = hashlib.sha256(body).hexdigest()
        message = "\n".join([node["node_id"], next_timestamp, reused_nonce, body_hash]).encode("utf-8")
        reused_signature = hmac.new(signing_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
        second_headers = {
            **headers,
            "X-Timestamp": next_timestamp,
            "X-Nonce": reused_nonce,
            "X-Signature": reused_signature,
        }

        second = client.post("/api/node/heartbeat", content=body, headers=second_headers)
        assert second.status_code == 409
        assert second.json()["code"] == "ERR_AUTH_NONCE_DUPLICATE"
        assert second.json()["message"] == "Duplicate nonce"

    def test_timestamp_must_be_strictly_increasing(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        node = _create_node(client, auth_headers, node_id="monotonic-node")
        payload = {"boot_id": "boot-001", "heartbeat_interval_sec": 5}
        body = json.dumps(payload).encode("utf-8")

        headers_1 = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
        first = client.post("/api/node/heartbeat", content=body, headers=headers_1)
        assert first.status_code == 200, first.text

        headers_2 = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
        repeated_timestamp = headers_1["X-Timestamp"]
        headers_2["X-Timestamp"] = repeated_timestamp
        signing_key = derive_node_signing_key(node["node_secret"])
        body_hash = hashlib.sha256(body).hexdigest()
        message = "\n".join([node["node_id"], repeated_timestamp, headers_2["X-Nonce"], body_hash]).encode("utf-8")
        headers_2["X-Signature"] = hmac.new(signing_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
        second = client.post("/api/node/heartbeat", content=body, headers=headers_2)

        assert second.status_code == 409
        assert second.json()["code"] == "ERR_AUTH_TIMESTAMP_REPLAY"
        assert second.json()["message"] == "Timestamp must be strictly increasing"

    def test_concurrent_duplicate_nonce_only_one_request_succeeds(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node = _create_node(client, auth_headers, node_id="concurrent-nonce-node")
        payload = {"boot_id": "boot-001", "heartbeat_interval_sec": 5}
        body = json.dumps(payload).encode("utf-8")
        headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
        base_timestamp = headers["X-Timestamp"]
        shared_nonce = headers["X-Nonce"]
        signing_key = derive_node_signing_key(node["node_secret"])
        body_hash = hashlib.sha256(body).hexdigest()
        barrier = Barrier(10)

        def send(index: int) -> tuple[int, dict[str, object]]:
            timestamp = (datetime.fromisoformat(base_timestamp) + timedelta(seconds=index)).isoformat()
            message = "\n".join([node["node_id"], timestamp, shared_nonce, body_hash]).encode("utf-8")
            signature = hmac.new(signing_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
            request_headers = {
                **headers,
                "X-Timestamp": timestamp,
                "X-Nonce": shared_nonce,
                "X-Signature": signature,
            }
            barrier.wait()
            with TestClient(app) as thread_client:
                resp = thread_client.post("/api/node/heartbeat", content=body, headers=request_headers)
            return resp.status_code, resp.json()

        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(send, range(10)))

        assert sum(status_code == 200 for status_code, _ in results) == 1
        duplicate_failures = [body for status_code, body in results if status_code == 409]
        assert len(duplicate_failures) == 9
        assert all(item["code"] == "ERR_AUTH_NONCE_DUPLICATE" for item in duplicate_failures)
        assert all(item["message"] == "Duplicate nonce" for item in duplicate_failures)

    def test_concurrent_same_timestamp_only_one_request_succeeds(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node = _create_node(client, auth_headers, node_id="concurrent-ts-node")
        payload = {"boot_id": "boot-001", "heartbeat_interval_sec": 5}
        body = json.dumps(payload).encode("utf-8")
        barrier = Barrier(10)
        headers_list: list[dict[str, str]] = []

        for _ in range(10):
            headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
            headers_list.append(headers)

        shared_timestamp = headers_list[0]["X-Timestamp"]
        signing_key = derive_node_signing_key(node["node_secret"])
        body_hash = hashlib.sha256(body).hexdigest()
        prepared_headers: list[dict[str, str]] = []
        for headers in headers_list:
            nonce = headers["X-Nonce"]
            message = "\n".join([node["node_id"], shared_timestamp, nonce, body_hash]).encode("utf-8")
            signature = hmac.new(signing_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
            prepared_headers.append({
                **headers,
                "X-Timestamp": shared_timestamp,
                "X-Signature": signature,
            })

        def send(index: int) -> tuple[int, dict[str, object]]:
            barrier.wait()
            with TestClient(app) as thread_client:
                resp = thread_client.post("/api/node/heartbeat", content=body, headers=prepared_headers[index])
            return resp.status_code, resp.json()

        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(send, range(10)))

        assert sum(status_code == 200 for status_code, _ in results) == 1
        timestamp_failures = [body for status_code, body in results if status_code == 409]
        assert len(timestamp_failures) == 9
        assert all(item["code"] == "ERR_AUTH_TIMESTAMP_REPLAY" for item in timestamp_failures)
        assert all(item["message"] == "Timestamp must be strictly increasing" for item in timestamp_failures)

    def test_background_nonce_prune_removes_expired_rows(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        node = _create_node(client, auth_headers, node_id="prune-node")
        settings = get_settings()
        db = Database(settings.database_path)
        expired_at = (datetime.now(UTC) - timedelta(minutes=5)).replace(microsecond=0).isoformat()

        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO nonces (node_id, nonce, timestamp_utc, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    node["node_id"],
                    "expired-nonce",
                    expired_at,
                    expired_at,
                ),
            )

        from app.background import lost_task_scanner

        scanner = lost_task_scanner(db)
        try:
            scanner.send(None)
        except StopIteration:
            pass
        except RuntimeError:
            pass

        with sqlite3.connect(settings.database_path) as conn:
            row = conn.execute(
                "SELECT 1 FROM nonces WHERE node_id = ? AND nonce = ?",
                (node["node_id"], "expired-nonce"),
            ).fetchone()

        assert row is None

"""Tests for nonce replay protection and monotonic timestamps."""

from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import Database
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
        assert second.status_code == 401
        assert second.json()["detail"] == "Nonce already used"

    def test_timestamp_must_be_strictly_increasing(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        node = _create_node(client, auth_headers, node_id="monotonic-node")
        payload = {"boot_id": "boot-001", "heartbeat_interval_sec": 5}
        body = json.dumps(payload).encode("utf-8")

        headers_1 = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
        first = client.post("/api/node/heartbeat", content=body, headers=headers_1)
        assert first.status_code == 200, first.text

        headers_2 = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
        headers_2["X-Timestamp"] = headers_1["X-Timestamp"]
        second = client.post("/api/node/heartbeat", content=body, headers=headers_2)

        assert second.status_code == 401
        assert second.json()["detail"] == "Timestamp must be strictly increasing"

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

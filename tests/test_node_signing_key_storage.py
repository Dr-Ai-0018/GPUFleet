"""Tests for encrypted node signing key storage and migration."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sqlite3

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import Database
from app.security import (
    build_signed_headers_for_test,
    decrypt_node_signing_key,
    derive_node_signing_key,
)


def _legacy_v1_encrypt(settings, signing_key: str) -> str:
    key = hashlib.sha256(settings.node_key_encryption_secret.encode("utf-8")).digest()
    nonce = b"legacy-nonce-000"
    plaintext = signing_key.encode("utf-8")
    output = bytearray()
    counter = 0
    while len(output) < len(plaintext):
        output.extend(hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest())
        counter += 1
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, output[: len(plaintext)]))
    tag = hmac.new(key, b"gpufleet-node-key-v1" + nonce + ciphertext, hashlib.sha256).digest()
    return "v1:" + base64.urlsafe_b64encode(nonce + ciphertext + tag).decode("ascii")


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "secure-node") -> dict[str, object]:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Secure Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/workspace"],
            "tags": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestNodeSigningKeyStorage:
    def test_create_node_stores_only_encrypted_signing_key(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node_data = _create_node(client, auth_headers)
        settings = get_settings()
        expected_signing_key = derive_node_signing_key(node_data["node_secret"])

        with sqlite3.connect(settings.database_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT node_signing_key, encrypted_signing_key
                FROM nodes
                WHERE node_id = ?
                """,
                (node_data["node_id"],),
            ).fetchone()

        assert row is not None
        assert row["node_signing_key"] == ""
        assert row["encrypted_signing_key"]
        assert row["encrypted_signing_key"].startswith("v2:")
        assert row["encrypted_signing_key"] != expected_signing_key
        assert decrypt_node_signing_key(settings, row["encrypted_signing_key"]) == expected_signing_key

    def test_legacy_v1_encrypted_key_still_decrypts(self) -> None:
        settings = get_settings()
        signing_key = derive_node_signing_key("legacy-secret")
        encrypted = _legacy_v1_encrypt(settings, signing_key)

        assert decrypt_node_signing_key(settings, encrypted) == signing_key

    def test_heartbeat_still_works_with_returned_secret(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node_data = _create_node(client, auth_headers, node_id="heartbeat-node")
        payload = {"boot_id": "boot-001", "heartbeat_interval_sec": 5}
        body = json.dumps(payload).encode("utf-8")
        headers = build_signed_headers_for_test(node_data["node_id"], node_data["node_secret"], body)

        resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)

        assert resp.status_code == 200, resp.text
        assert resp.json()["node_id"] == node_data["node_id"]

    def test_reset_secret_invalidates_old_secret_and_rotates_encrypted_key(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ) -> None:
        node_data = _create_node(client, auth_headers, node_id="reset-node")
        settings = get_settings()
        old_secret = node_data["node_secret"]

        with sqlite3.connect(settings.database_path) as conn:
            conn.row_factory = sqlite3.Row
            old_row = conn.execute(
                "SELECT encrypted_signing_key FROM nodes WHERE node_id = ?",
                ("reset-node",),
            ).fetchone()

        reset_resp = client.post("/api/v1/admin/nodes/reset-node/reset-secret", headers=auth_headers)
        assert reset_resp.status_code == 200, reset_resp.text
        new_secret = reset_resp.json()["node_secret"]
        assert new_secret != old_secret

        with sqlite3.connect(settings.database_path) as conn:
            conn.row_factory = sqlite3.Row
            new_row = conn.execute(
                "SELECT encrypted_signing_key FROM nodes WHERE node_id = ?",
                ("reset-node",),
            ).fetchone()

        assert old_row is not None and new_row is not None
        assert new_row["encrypted_signing_key"] != old_row["encrypted_signing_key"]

        payload = {"boot_id": "boot-002", "heartbeat_interval_sec": 5}
        body = json.dumps(payload).encode("utf-8")

        old_headers = build_signed_headers_for_test("reset-node", old_secret, body)
        old_resp = client.post("/api/v1/node/heartbeat", content=body, headers=old_headers)
        assert old_resp.status_code == 401

        new_headers = build_signed_headers_for_test("reset-node", new_secret, body)
        new_resp = client.post("/api/v1/node/heartbeat", content=body, headers=new_headers)
        assert new_resp.status_code == 200, new_resp.text

    def test_legacy_plaintext_signing_key_is_migrated_to_encrypted_storage(self, tmp_path) -> None:
        db_path = tmp_path / "legacy.db"
        legacy_signing_key = derive_node_signing_key("legacy-secret")

        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """
                CREATE TABLE nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    node_signing_key TEXT,
                    node_type TEXT NOT NULL,
                    os_type TEXT,
                    hostname TEXT,
                    heartbeat_interval_sec INTEGER NOT NULL DEFAULT 5,
                    allowed_workdirs_json TEXT NOT NULL DEFAULT '[]',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    is_enabled INTEGER NOT NULL DEFAULT 1,
                    first_seen_at TEXT,
                    last_seen_at TEXT,
                    last_boot_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO nodes (
                    node_id, display_name, node_signing_key, node_type, os_type, hostname,
                    heartbeat_interval_sec, allowed_workdirs_json, tags_json,
                    is_enabled, first_seen_at, last_seen_at, last_boot_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "legacy-node",
                    "Legacy Node",
                    legacy_signing_key,
                    "physical",
                    "linux",
                    None,
                    5,
                    "[]",
                    "[]",
                    1,
                    None,
                    None,
                    None,
                    "2026-05-24T00:00:00+00:00",
                    "2026-05-24T00:00:00+00:00",
                ),
            )
            conn.commit()

        Database(db_path).init_schema()
        settings = get_settings()

        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT node_signing_key, encrypted_signing_key FROM nodes WHERE node_id = ?",
                ("legacy-node",),
            ).fetchone()

        assert row is not None
        assert row["node_signing_key"] == ""
        assert row["encrypted_signing_key"]
        assert decrypt_node_signing_key(settings, row["encrypted_signing_key"]) == legacy_signing_key

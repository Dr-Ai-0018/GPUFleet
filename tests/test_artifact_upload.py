"""Tests for artifact upload security: ownership check before write, size limits."""

from __future__ import annotations

import json
from base64 import b64encode

from fastapi.testclient import TestClient

from app.security import build_signed_headers_for_test


def _setup_node_and_task(client: TestClient, auth_headers: dict[str, str]) -> tuple[str, str, str]:
    """Create a node and task, return (node_id, node_secret, task_id)."""
    resp = client.post("/api/admin/nodes", headers=auth_headers, json={
        "node_id": "artifact-node",
        "display_name": "Artifact Test Node",
        "node_type": "physical",
        "os_type": "linux",
        "heartbeat_interval_sec": 5,
        "allowed_workdirs": ["/tmp"],
    })
    assert resp.status_code == 201
    node_secret = resp.json()["node_secret"]

    resp = client.post("/api/admin/tasks", headers=auth_headers, json={
        "node_id": "artifact-node",
        "type": "shell",
        "payload": {"command": "echo hi"},
        "workdir": "/tmp",
    })
    assert resp.status_code == 201
    task_id = resp.json()["task_id"]

    return "artifact-node", node_secret, task_id


class TestArtifactUploadSecurity:
    def test_upload_wrong_node_rejected(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """A node should not be able to upload artifacts for another node's task."""
        _, node_secret, task_id = _setup_node_and_task(client, auth_headers)

        # Create a second node
        resp = client.post("/api/admin/nodes", headers=auth_headers, json={
            "node_id": "other-node",
            "display_name": "Other Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp"],
        })
        assert resp.status_code == 201
        other_secret = resp.json()["node_secret"]

        # Try to upload artifact as other-node for artifact-node's task
        payload = {
            "task_id": task_id,
            "artifact_name": "evil.txt",
            "artifact_type": "file",
            "content_base64": b64encode(b"malicious content").decode(),
            "content_type": "text/plain",
            "preview": {},
        }
        body = json.dumps(payload).encode()
        headers = build_signed_headers_for_test("other-node", other_secret, body)
        resp = client.post("/api/node/artifact-upload", content=body, headers=headers)
        assert resp.status_code == 404  # Task not found for this node

    def test_upload_size_limit(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """Artifacts exceeding size limit should be rejected."""
        node_id, node_secret, task_id = _setup_node_and_task(client, auth_headers)

        # Override max_artifact_bytes to a small value for testing
        from app.config import get_settings
        settings = get_settings()
        original_max = settings.max_artifact_bytes
        settings.max_artifact_bytes = 100  # 100 bytes

        try:
            # Create content larger than limit
            large_content = b"x" * 200
            payload = {
                "task_id": task_id,
                "artifact_name": "big.bin",
                "artifact_type": "file",
                "content_base64": b64encode(large_content).decode(),
                "content_type": "application/octet-stream",
                "preview": {},
            }
            body = json.dumps(payload).encode()
            headers = build_signed_headers_for_test(node_id, node_secret, body)
            resp = client.post("/api/node/artifact-upload", content=body, headers=headers)
            assert resp.status_code == 413
        finally:
            settings.max_artifact_bytes = original_max

    def test_upload_success(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        """Valid artifact upload should succeed."""
        node_id, node_secret, task_id = _setup_node_and_task(client, auth_headers)

        content = b"hello artifact"
        payload = {
            "task_id": task_id,
            "artifact_name": "output.txt",
            "artifact_type": "file",
            "content_base64": b64encode(content).decode(),
            "content_type": "text/plain",
            "preview": {},
        }
        body = json.dumps(payload).encode()
        headers = build_signed_headers_for_test(node_id, node_secret, body)
        resp = client.post("/api/node/artifact-upload", content=body, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["artifact_name"] == "output.txt"
        assert data["size_bytes"] == len(content)

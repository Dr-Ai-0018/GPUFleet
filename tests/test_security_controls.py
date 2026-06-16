"""Tests for security middleware and rate limiting."""

from __future__ import annotations

from fastapi.testclient import TestClient
from httpx import Response


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "node-rate") -> None:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Rate Test Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/workspace"],
            "tags": [],
        },
    )
    assert resp.status_code == 201, resp.text


def _assert_rate_limited(resp: Response) -> None:
    assert resp.status_code == 429

    body = resp.json()
    assert body["code"] == "ERR_RATE_LIMITED"
    assert body["message"] == "Rate limit exceeded"
    assert "detail" not in body
    assert isinstance(body["details"]["retry_after_sec"], int)


class TestCorsPolicy:
    def test_preflight_returns_whitelisted_methods_and_headers(self, client: TestClient) -> None:
        resp = client.options(
            "/api/v1/admin/login",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Authorization, X-Node-Id",
            },
        )

        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert resp.headers["access-control-allow-methods"] == "GET, POST, PATCH, DELETE, OPTIONS"
        assert resp.headers["access-control-allow-headers"] == (
            "Accept, Accept-Language, Authorization, Content-Language, "
            "Content-Type, X-Node-Id, X-Nonce, X-Signature, X-Timestamp"
        )


class TestRateLimits:
    def test_heartbeat_rate_limit_uses_node_id_key(self, client: TestClient) -> None:
        headers = {
            "X-Node-Id": "node-rate-limit",
            "X-Timestamp": "2026-05-24T00:00:00Z",
            "X-Nonce": "nonce-static",
            "X-Signature": "invalid",
        }
        for i in range(60):
            resp = client.post("/api/v1/node/heartbeat", headers=headers, json={"boot_id": "boot-1"})
            assert resp.status_code == 401, f"Attempt {i + 1} should be 401"

        resp = client.post("/api/v1/node/heartbeat", headers=headers, json={"boot_id": "boot-1"})
        _assert_rate_limited(resp)

    def test_create_node_rate_limit(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        for i in range(30):
            resp = client.post(
                "/api/v1/admin/nodes",
                headers=auth_headers,
                json={
                    "node_id": f"node-{i:02d}",
                    "display_name": f"Node {i:02d}",
                    "node_type": "physical",
                    "os_type": "linux",
                    "heartbeat_interval_sec": 5,
                    "allowed_workdirs": ["/workspace"],
                    "tags": [],
                },
            )
            assert resp.status_code == 201, f"Attempt {i + 1} failed: {resp.text}"

        resp = client.post(
            "/api/v1/admin/nodes",
            headers=auth_headers,
            json={
                "node_id": "node-31",
                "display_name": "Node 31",
                "node_type": "physical",
                "os_type": "linux",
                "heartbeat_interval_sec": 5,
                "allowed_workdirs": ["/workspace"],
                "tags": [],
            },
        )
        _assert_rate_limited(resp)

    def test_create_task_rate_limit(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        _create_node(client, auth_headers)

        for i in range(30):
            resp = client.post(
                "/api/v1/admin/tasks",
                headers=auth_headers,
                json={
                    "node_id": "node-rate",
                    "type": "health_check",
                    "payload": {},
                    "task_id": f"task-{i:02d}",
                    "workdir": "/workspace",
                },
            )
            assert resp.status_code == 201, f"Attempt {i + 1} failed: {resp.text}"

        resp = client.post(
            "/api/v1/admin/tasks",
            headers=auth_headers,
            json={
                "node_id": "node-rate",
                "type": "health_check",
                "payload": {},
                "task_id": "task-31",
                "workdir": "/workspace",
            },
        )
        _assert_rate_limited(resp)

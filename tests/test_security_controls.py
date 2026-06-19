"""Tests for security middleware and rate limiting."""

from __future__ import annotations

from fastapi.testclient import TestClient
from httpx import Response

from app.config import get_settings
from app.db import Database, dumps_json, utc_now_iso


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


def _insert_alert() -> int:
    db = Database(get_settings().database_path)
    now_iso = utc_now_iso()
    with db.connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO alert_messages (
                alert_type, severity, title, summary, detail_json,
                target_type, target_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "test.alert",
                "warning",
                "Test alert",
                "rate limit fixture",
                dumps_json({"ok": True}),
                "task",
                "task-rate",
                "unread",
                now_iso,
            ),
        )
        return int(cursor.lastrowid)


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

    def test_alerts_unread_count_rate_limit(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        # W2: unread-count 提到 60/min (前端 AlertsBell 10s 轮询 = 6/min/admin, 安全)
        for i in range(60):
            resp = client.get("/api/v1/admin/alerts/unread-count", headers=auth_headers)
            assert resp.status_code == 200, f"Attempt {i + 1} failed: {resp.text}"

        resp = client.get("/api/v1/admin/alerts/unread-count", headers=auth_headers)
        _assert_rate_limited(resp)

    def test_mark_alert_read_rate_limit(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        alert_id = _insert_alert()
        for i in range(30):
            resp = client.post(f"/api/v1/admin/alerts/{alert_id}/read", headers=auth_headers)
            assert resp.status_code == 200, f"Attempt {i + 1} failed: {resp.text}"

        resp = client.post(f"/api/v1/admin/alerts/{alert_id}/read", headers=auth_headers)
        _assert_rate_limited(resp)

    def test_alerts_rate_limit_keyed_by_admin_not_ip(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        """W2 守卫: 限流按 admin.sub 计量, 同 IP 不同 admin token 不互饿."""
        from app.security import create_access_token, hash_password
        from app.config import get_settings
        from app.db import Database, utc_now_iso

        # admin#1 把 60/min unread-count 桶打满
        for _ in range(60):
            resp = client.get("/api/v1/admin/alerts/unread-count", headers=auth_headers)
            assert resp.status_code == 200

        # 同 admin 第 61 次必 429
        resp = client.get("/api/v1/admin/alerts/unread-count", headers=auth_headers)
        _assert_rate_limited(resp)

        # 创第二个 admin + 拿新 token, 同 client (= 同 IP) 调用应仍能通过 —
        # 证明限流 key 是 admin 而非 IP
        settings = get_settings()
        now_iso = utc_now_iso()
        db = Database(settings.database_path)
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO admins (username, password_hash, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
                ("admin2_w2", hash_password("x"), now_iso, now_iso),
            )
        token2 = create_access_token(settings, "admin2_w2")
        resp = client.get(
            "/api/v1/admin/alerts/unread-count",
            headers={"Authorization": f"Bearer {token2}"},
        )
        assert resp.status_code == 200, f"admin2 应不受 admin1 桶影响, 实际: {resp.text}"

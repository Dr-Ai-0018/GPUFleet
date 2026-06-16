"""Tests for admin authentication endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import Database
from app.security import decode_token


class TestLogin:
    def test_login_success(self, client: TestClient) -> None:
        resp = client.post("/api/v1/admin/login", json={
            "username": "admin",
            "password": "test-admin-pass",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self, client: TestClient) -> None:
        resp = client.post("/api/v1/admin/login", json={
            "username": "admin",
            "password": "wrong-password",
        })
        assert resp.status_code == 401

    def test_login_wrong_username(self, client: TestClient) -> None:
        resp = client.post("/api/v1/admin/login", json={
            "username": "nonexistent",
            "password": "test-admin-pass",
        })
        assert resp.status_code == 401

    def test_login_rate_limit(self, client: TestClient) -> None:
        """After 5 failed attempts, the 6th should be rate-limited (429)."""
        for i in range(5):
            resp = client.post("/api/v1/admin/login", json={
                "username": "admin",
                "password": "wrong",
            })
            assert resp.status_code == 401, f"Attempt {i+1} should be 401"

        resp = client.post("/api/v1/admin/login", json={
            "username": "admin",
            "password": "wrong",
        })
        assert resp.status_code == 429


class TestRefresh:
    def test_refresh_success(self, client: TestClient) -> None:
        login_resp = client.post("/api/v1/admin/login", json={
            "username": "admin",
            "password": "test-admin-pass",
        })
        refresh_token = login_resp.json()["refresh_token"]

        resp = client.post("/api/v1/admin/refresh", json={
            "refresh_token": refresh_token,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data

    def test_refresh_invalid_token(self, client: TestClient) -> None:
        resp = client.post("/api/v1/admin/refresh", json={
            "refresh_token": "invalid-token",
        })
        assert resp.status_code == 401

    def test_refresh_token_invalidated_after_admin_invalidation(self, client: TestClient) -> None:
        login_resp = client.post("/api/v1/admin/login", json={
            "username": "admin",
            "password": "test-admin-pass",
        })
        refresh_token = login_resp.json()["refresh_token"]

        settings = get_settings()
        payload = decode_token(settings, refresh_token, "refresh")
        invalidated_at = datetime.fromtimestamp(payload["iat"], tz=UTC).replace(microsecond=0).isoformat()
        db = Database(settings.database_path)
        with db.connect() as conn:
            conn.execute(
                "UPDATE admins SET tokens_invalidated_at = ?, updated_at = ? WHERE username = ?",
                (invalidated_at, invalidated_at, "admin"),
            )

        resp = client.post("/api/v1/admin/refresh", json={
            "refresh_token": refresh_token,
        })
        assert resp.status_code == 401
        assert resp.json()["code"] == "ERR_AUTH_REFRESH_REVOKED"
        assert resp.json()["message"] == "Refresh token has been invalidated"


class TestMe:
    def test_me_authenticated(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        resp = client.get("/api/v1/admin/me", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["username"] == "admin"
        assert data["is_active"] is True

    def test_me_unauthenticated(self, client: TestClient) -> None:
        resp = client.get("/api/v1/admin/me")
        assert resp.status_code == 401

    def test_me_invalid_token(self, client: TestClient) -> None:
        resp = client.get("/api/v1/admin/me", headers={"Authorization": "Bearer invalid"})
        assert resp.status_code == 401

    def test_me_rejects_invalidated_access_token(self, client: TestClient, admin_token: str) -> None:
        settings = get_settings()
        payload = decode_token(settings, admin_token, "access")
        invalidated_at = datetime.fromtimestamp(payload["iat"], tz=UTC).replace(microsecond=0).isoformat()
        db = Database(settings.database_path)
        with db.connect() as conn:
            conn.execute(
                "UPDATE admins SET tokens_invalidated_at = ?, updated_at = ? WHERE username = ?",
                (invalidated_at, invalidated_at, "admin"),
            )

        resp = client.get("/api/v1/admin/me", headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 401
        assert resp.json()["code"] == "ERR_AUTH_TOKEN_REVOKED"
        assert resp.json()["message"] == "Access token has been invalidated"


class TestLogout:
    def test_logout_invalidates_current_access_and_refresh_tokens(self, client: TestClient) -> None:
        login_resp = client.post("/api/v1/admin/login", json={
            "username": "admin",
            "password": "test-admin-pass",
        })
        assert login_resp.status_code == 200
        tokens = login_resp.json()
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        logout_resp = client.post("/api/v1/admin/logout", headers=headers)
        assert logout_resp.status_code == 200
        assert logout_resp.json() == {"ok": True}

        me_resp = client.get("/api/v1/admin/me", headers=headers)
        assert me_resp.status_code == 401
        assert me_resp.json()["code"] == "ERR_AUTH_TOKEN_REVOKED"
        assert me_resp.json()["message"] == "Access token has been invalidated"

        refresh_resp = client.post("/api/v1/admin/refresh", json={
            "refresh_token": tokens["refresh_token"],
        })
        assert refresh_resp.status_code == 401
        assert refresh_resp.json()["code"] == "ERR_AUTH_REFRESH_REVOKED"
        assert refresh_resp.json()["message"] == "Refresh token has been invalidated"

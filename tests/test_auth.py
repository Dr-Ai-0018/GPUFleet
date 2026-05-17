"""Tests for admin authentication endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


class TestLogin:
    def test_login_success(self, client: TestClient) -> None:
        resp = client.post("/api/admin/login", json={
            "username": "admin",
            "password": "test-admin-pass",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self, client: TestClient) -> None:
        resp = client.post("/api/admin/login", json={
            "username": "admin",
            "password": "wrong-password",
        })
        assert resp.status_code == 401

    def test_login_wrong_username(self, client: TestClient) -> None:
        resp = client.post("/api/admin/login", json={
            "username": "nonexistent",
            "password": "test-admin-pass",
        })
        assert resp.status_code == 401

    def test_login_rate_limit(self, client: TestClient) -> None:
        """After 5 failed attempts, the 6th should be rate-limited (429)."""
        for i in range(5):
            resp = client.post("/api/admin/login", json={
                "username": "admin",
                "password": "wrong",
            })
            assert resp.status_code == 401, f"Attempt {i+1} should be 401"

        resp = client.post("/api/admin/login", json={
            "username": "admin",
            "password": "wrong",
        })
        assert resp.status_code == 429


class TestRefresh:
    def test_refresh_success(self, client: TestClient) -> None:
        login_resp = client.post("/api/admin/login", json={
            "username": "admin",
            "password": "test-admin-pass",
        })
        refresh_token = login_resp.json()["refresh_token"]

        resp = client.post("/api/admin/refresh", json={
            "refresh_token": refresh_token,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data

    def test_refresh_invalid_token(self, client: TestClient) -> None:
        resp = client.post("/api/admin/refresh", json={
            "refresh_token": "invalid-token",
        })
        assert resp.status_code == 401


class TestMe:
    def test_me_authenticated(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        resp = client.get("/api/admin/me", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["username"] == "admin"
        assert data["is_active"] is True

    def test_me_unauthenticated(self, client: TestClient) -> None:
        resp = client.get("/api/admin/me")
        assert resp.status_code == 401

    def test_me_invalid_token(self, client: TestClient) -> None:
        resp = client.get("/api/admin/me", headers={"Authorization": "Bearer invalid"})
        assert resp.status_code == 401

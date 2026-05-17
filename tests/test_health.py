"""Tests for /healthz and /readyz endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


class TestHealthz:
    def test_healthz(self, client: TestClient) -> None:
        resp = client.get("/healthz")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestReadyz:
    def test_readyz_healthy(self, client: TestClient) -> None:
        resp = client.get("/readyz")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ready"}

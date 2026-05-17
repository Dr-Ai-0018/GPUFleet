"""Shared test fixtures for GPUFleet backend tests."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Generator

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _env_setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Set required env vars and use a temp database for each test."""
    monkeypatch.setenv("GPUFLEET_JWT_SECRET", "test-secret-at-least-32-bytes-long!!")
    monkeypatch.setenv("GPUFLEET_DEFAULT_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("GPUFLEET_DEFAULT_ADMIN_PASSWORD", "test-admin-pass")
    monkeypatch.setenv("GPUFLEET_DATABASE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("GPUFLEET_STORAGE_PATH", str(tmp_path / "storage"))
    # Prevent pydantic-settings from reading the project .env file
    monkeypatch.chdir(tmp_path)


@pytest.fixture()
def client(_env_setup: None) -> Generator[TestClient, None, None]:
    """Create a fresh TestClient with a clean database for each test."""
    # Clear the lru_cache so settings are re-read with test env vars
    from app.config import get_settings
    get_settings.cache_clear()

    from app.main import app
    from app.routers.admin_auth import limiter

    # Reset rate limiter storage between tests
    limiter.reset()

    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


@pytest.fixture()
def admin_token(client: TestClient) -> str:
    """Login as admin and return the access token."""
    resp = client.post("/api/admin/login", json={
        "username": "admin",
        "password": "test-admin-pass",
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["access_token"]


@pytest.fixture()
def auth_headers(admin_token: str) -> dict[str, str]:
    """Return Authorization headers for admin requests."""
    return {"Authorization": f"Bearer {admin_token}"}

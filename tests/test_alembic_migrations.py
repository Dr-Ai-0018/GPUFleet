"""Regression tests for Alembic migration wiring."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import get_settings


def test_alembic_upgrade_and_downgrade_round_trip(_env_setup: None, monkeypatch) -> None:
    get_settings.cache_clear()
    settings = get_settings()
    repo_root = Path(__file__).resolve().parents[1]
    cfg = Config(str(repo_root / "alembic.ini"))

    command.upgrade(cfg, "head")

    with sqlite3.connect(settings.database_path) as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    assert "admins" in tables
    assert "tasks" in tables
    assert "alembic_version" in tables

    command.downgrade(cfg, "base")

    with sqlite3.connect(settings.database_path) as conn:
        tables_after = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }

    assert "admins" not in tables_after
    assert "tasks" not in tables_after
    get_settings.cache_clear()

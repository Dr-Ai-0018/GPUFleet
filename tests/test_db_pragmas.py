"""Tests for SQLite connection pragmas used by the control plane."""

from __future__ import annotations

from app.config import get_settings
from app.db import Database


def test_database_connect_enables_wal_and_busy_timeout(_env_setup: None) -> None:
    get_settings.cache_clear()
    settings = get_settings()
    db = Database(settings.database_path)
    db.init_schema()

    with db.connect() as conn:
        journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        busy_timeout = conn.execute("PRAGMA busy_timeout").fetchone()[0]
        foreign_keys = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        synchronous = conn.execute("PRAGMA synchronous").fetchone()[0]

    assert str(journal_mode).lower() == "wal"
    assert int(busy_timeout) == settings.sqlite_busy_timeout_ms
    assert int(foreign_keys) == 1
    assert int(synchronous) == 1  # NORMAL
    get_settings.cache_clear()

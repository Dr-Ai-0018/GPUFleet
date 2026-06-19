"""Security-sensitive startup configuration tests."""

from __future__ import annotations

import pytest


def test_missing_node_key_encryption_secret_fails_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import get_settings

    monkeypatch.delenv("GPUFLEET_NODE_KEY_ENCRYPTION_SECRET", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(SystemExit):
            get_settings()
    finally:
        get_settings.cache_clear()

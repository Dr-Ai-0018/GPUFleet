from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

from gpufleet_node_agent.config import AgentSettings  # noqa: E402
from gpufleet_node_agent import security  # noqa: E402


def _settings(
    tmp_path: Path,
    *,
    node_secret: str = "",
    node_secret_passphrase: str = "",
    encrypted_name: str = "node_secret.enc",
) -> AgentSettings:
    return AgentSettings(
        _env_file=None,
        control_plane_url="https://example.com",
        node_id="node-1",
        node_secret=node_secret,
        node_secret_passphrase=node_secret_passphrase,
        state_dir=tmp_path / "state",
        agent_root=tmp_path / "runtime",
        repos_dir=tmp_path / "runtime" / "repos",
        runs_dir=tmp_path / "runtime" / "runs",
        artifacts_dir=tmp_path / "runtime" / "artifacts",
        logs_dir=tmp_path / "runtime" / "logs",
        modal_profiles_dir=tmp_path / "runtime" / "modal_profiles",
        node_secret_encrypted_path=tmp_path / encrypted_name,
    )


def test_windows_bootstrap_seals_plaintext_secret(tmp_path: Path) -> None:
    settings = _settings(tmp_path, node_secret="bootstrap-secret")
    settings.ensure_dirs()

    resolved = settings.get_node_secret()
    store_path = settings.secret_store_path()

    assert resolved == "bootstrap-secret"
    assert store_path.exists()
    raw_text = store_path.read_text(encoding="utf-8")
    assert "bootstrap-secret" not in raw_text
    payload = json.loads(raw_text)
    assert payload["scheme"] == "dpapi-v1"


def test_windows_reload_uses_encrypted_store_without_plaintext(tmp_path: Path) -> None:
    first = _settings(tmp_path, node_secret="persisted-secret")
    first.ensure_dirs()
    assert first.get_node_secret() == "persisted-secret"

    reloaded = _settings(tmp_path)
    reloaded.ensure_dirs()
    assert reloaded.get_node_secret() == "persisted-secret"


def test_plaintext_rotation_reseals_existing_store(tmp_path: Path) -> None:
    initial = _settings(tmp_path, node_secret="old-secret")
    initial.ensure_dirs()
    assert initial.get_node_secret() == "old-secret"

    rotated = _settings(tmp_path, node_secret="new-secret")
    rotated.ensure_dirs()
    assert rotated.get_node_secret() == "new-secret"

    final = _settings(tmp_path)
    final.ensure_dirs()
    assert final.get_node_secret() == "new-secret"


def test_non_windows_fallback_requires_passphrase(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(security.os, "name", "posix")
    settings = _settings(tmp_path, node_secret="linux-secret")
    settings.ensure_dirs()

    with pytest.raises(ValueError, match="NODE_SECRET_PASSPHRASE"):
        settings.get_node_secret()


def test_non_windows_passphrase_fallback_round_trip(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(security.os, "name", "posix")
    sealed = _settings(
        tmp_path,
        node_secret="linux-secret",
        node_secret_passphrase="strong-local-passphrase",
        encrypted_name="linux_secret.enc",
    )
    sealed.ensure_dirs()
    assert sealed.get_node_secret() == "linux-secret"

    reloaded = _settings(
        tmp_path,
        node_secret_passphrase="strong-local-passphrase",
        encrypted_name="linux_secret.enc",
    )
    reloaded.ensure_dirs()
    assert reloaded.get_node_secret() == "linux-secret"

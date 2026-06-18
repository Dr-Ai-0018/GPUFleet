from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

from gpufleet_node_agent.config import AgentSettings  # noqa: E402


def test_agent_settings_accepts_default_sampling_window() -> None:
    settings = AgentSettings()

    assert settings.heartbeat_interval_sec == 5
    assert settings.sample_interval_sec == 1
    assert settings.sample_buffer_size == 5


def test_agent_settings_rejects_sample_interval_longer_than_heartbeat() -> None:
    with pytest.raises(ValidationError, match="sample_interval_sec must be <= heartbeat_interval_sec"):
        AgentSettings(heartbeat_interval_sec=5, sample_interval_sec=6)

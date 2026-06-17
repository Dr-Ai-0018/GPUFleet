"""Node agent heartbeat payload live metric overlay."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

from gpufleet_node_agent.heartbeat import build_heartbeat_payload  # noqa: E402


class FakeSampleBuffer:
    def drain(self) -> list[dict[str, object]]:
        return [
            {
                "ts": "2026-06-17T02:45:35.545+00:00",
                "cpu_percent": 41.2,
                "memory_percent": 88.6,
                "upload_bps": 1234.5,
                "download_bps": 9876.5,
                "gpus": [
                    {
                        "idx": 0,
                        "util": 40.0,
                        "temp_c": 53.0,
                        "vram_used_bytes": 452_362_240,
                        "power_w": 4.81,
                    }
                ],
            }
        ]


def test_build_heartbeat_payload_overlays_live_sample_metrics(monkeypatch) -> None:
    fingerprint = {
        "boot_id": "boot-live",
        "agent_version": "test",
        "hostname": "node",
        "heartbeat_interval_sec": 5,
        "sample_interval_sec": 1,
        "cpu": {"usage_percent": 10.0, "model": "CPU"},
        "memory": {"usage_percent": 20.0, "total_bytes": 1000},
        "disks": [],
        "gpus": [
            {
                "index": 0,
                "model": "GPU",
                "total_vram_mb": 4096,
                "used_vram_mb": 393,
                "utilization_percent": 36.0,
                "temperature_c": 56.0,
                "power_draw_w": 8.27,
            }
        ],
        "nvidia": {},
        "python_env": {},
        "extra": {"network": {"adapter_name": "Wi-Fi"}},
    }
    monkeypatch.setattr("gpufleet_node_agent.heartbeat.get_cached_fingerprint", lambda _settings: fingerprint)
    monkeypatch.setattr("gpufleet_node_agent.heartbeat.collect_task_runtime", lambda _settings: {})

    payload = build_heartbeat_payload(SimpleNamespace(), sample_buffer=FakeSampleBuffer())

    assert payload["cpu"]["usage_percent"] == 41.2
    assert payload["memory"]["usage_percent"] == 88.6
    assert payload["gpus"][0]["utilization_percent"] == 40.0
    assert payload["gpus"][0]["temperature_c"] == 53.0
    assert payload["gpus"][0]["used_vram_mb"] == 431
    assert payload["gpus"][0]["power_draw_w"] == 4.81
    assert payload["extra"]["network"]["tx_bytes_per_sec"] == 1234.5
    assert payload["extra"]["network"]["rx_bytes_per_sec"] == 9876.5
    assert payload["samples"][0]["gpus"][0]["util"] == 40.0


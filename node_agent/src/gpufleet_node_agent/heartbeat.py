from __future__ import annotations

import platform
from pathlib import Path
from typing import Any

from gpufleet_node_agent.api_client import post_signed_json
from gpufleet_node_agent.collect import (
    collect_cpu,
    collect_disks,
    collect_gpus,
    collect_memory,
    collect_nvidia,
    collect_primary_network,
    collect_python_env,
    collect_task_runtime,
    get_boot_id,
)
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.modal_support import collect_modal_runtime_status
from gpufleet_node_agent.sampler import SampleRingBuffer


def build_heartbeat_payload(
    settings: AgentSettings,
    sample_buffer: SampleRingBuffer | None = None,
) -> dict[str, Any]:
    """构造心跳 payload.

    sample_buffer 传入时, drain() 全部累积 sample 装入 payload.samples; 不传则退化为单点心跳.
    """
    payload: dict[str, Any] = {
        "boot_id": get_boot_id(settings),
        "agent_version": "0.2.0",
        "hostname": platform.node(),
        "heartbeat_interval_sec": settings.heartbeat_interval_sec,
        "sample_interval_sec": settings.sample_interval_sec if sample_buffer is not None else None,
        "cpu": collect_cpu(),
        "memory": collect_memory(),
        "disks": collect_disks(settings),
        "gpus": collect_gpus(),
        "nvidia": collect_nvidia(),
        "python_env": collect_python_env(settings),
        "task_runtime": collect_task_runtime(settings),
        "extra": {
            "agent_root": str(Path(settings.agent_root).resolve()),
            "platform": platform.platform(),
            "deployment_mode": settings.deployment_mode,
            "effective_deployment_mode": settings.effective_deployment_mode(),
            "network": collect_primary_network(settings),
            "modal_runtime": collect_modal_runtime_status(settings),
        },
        "samples": sample_buffer.drain() if sample_buffer is not None else [],
    }
    return payload


def send_heartbeat(
    settings: AgentSettings,
    sample_buffer: SampleRingBuffer | None = None,
) -> dict[str, Any]:
    payload = build_heartbeat_payload(settings, sample_buffer=sample_buffer)
    return post_signed_json(settings, "/api/node/heartbeat", payload, timeout=30)

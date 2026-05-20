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


def build_heartbeat_payload(settings: AgentSettings) -> dict[str, Any]:
    return {
        "boot_id": get_boot_id(settings),
        "agent_version": "0.1.0",
        "hostname": platform.node(),
        "heartbeat_interval_sec": settings.heartbeat_interval_sec,
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
    }


def send_heartbeat(settings: AgentSettings) -> dict[str, Any]:
    payload = build_heartbeat_payload(settings)
    return post_signed_json(settings, "/api/node/heartbeat", payload, timeout=30)

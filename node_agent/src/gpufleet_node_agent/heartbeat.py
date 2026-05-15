from __future__ import annotations

import json
import platform
from pathlib import Path
from typing import Any

import requests

from gpufleet_node_agent.collect import (
    collect_cpu,
    collect_disks,
    collect_gpus,
    collect_memory,
    collect_python_env,
    collect_task_runtime,
    get_boot_id,
)
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.security import build_headers


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
        "python_env": collect_python_env(settings),
        "task_runtime": collect_task_runtime(settings),
        "extra": {
            "agent_root": str(Path(settings.agent_root).resolve()),
            "platform": platform.platform(),
        },
    }


def send_heartbeat(settings: AgentSettings) -> dict[str, Any]:
    payload = build_heartbeat_payload(settings)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    response = requests.post(
        f"{settings.control_plane_url.rstrip('/')}/api/node/heartbeat",
        data=body,
        headers=build_headers(settings.node_id, settings.node_secret, body),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()

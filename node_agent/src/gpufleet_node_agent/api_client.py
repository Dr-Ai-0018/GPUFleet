from __future__ import annotations

import json
from base64 import b64encode
from typing import Any

import requests

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.security import build_headers


def post_signed_json(settings: AgentSettings, path: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    response = requests.post(
        f"{settings.control_plane_url.rstrip('/')}{path}",
        data=body,
        headers=build_headers(settings.node_id, settings.node_secret, body),
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()


def send_task_event(settings: AgentSettings, payload: dict[str, Any]) -> dict[str, Any]:
    return post_signed_json(settings, "/api/node/task-events", payload, timeout=30)


def send_task_log_chunk(settings: AgentSettings, payload: dict[str, Any]) -> dict[str, Any]:
    return post_signed_json(settings, "/api/node/task-log-chunk", payload, timeout=60)


def send_task_result(settings: AgentSettings, payload: dict[str, Any]) -> dict[str, Any]:
    return post_signed_json(settings, "/api/node/task-result", payload, timeout=60)


def send_artifact_file(
    settings: AgentSettings,
    *,
    task_id: str,
    artifact_name: str,
    artifact_type: str,
    artifact_bytes: bytes,
    content_type: str | None,
    preview: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "task_id": task_id,
        "artifact_name": artifact_name,
        "artifact_type": artifact_type,
        "content_base64": b64encode(artifact_bytes).decode("ascii"),
        "content_type": content_type,
        "preview": preview or {},
    }
    return post_signed_json(settings, "/api/node/artifact-upload", payload, timeout=120)

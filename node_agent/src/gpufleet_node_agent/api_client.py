from __future__ import annotations

import json
import logging
import time
from base64 import b64encode
from typing import Any

import requests

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.security import build_headers

logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 3
BACKOFF_BASE_SEC = 1.0  # 1s, 2s, 4s

# HTTP status codes that are transient and worth retrying
_TRANSIENT_STATUS_CODES = {500, 502, 503, 504, 429}


def _is_transient_error(exc: Exception) -> bool:
    """Determine if an error is transient (worth retrying)."""
    if isinstance(exc, requests.exceptions.ConnectionError):
        return True
    if isinstance(exc, requests.exceptions.Timeout):
        return True
    if isinstance(exc, requests.exceptions.HTTPError) and exc.response is not None:
        return exc.response.status_code in _TRANSIENT_STATUS_CODES
    return False


def post_signed_json(settings: AgentSettings, path: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    url = f"{settings.control_plane_url.rstrip('/')}{path}"
    verify_tls = not getattr(settings, "tls_skip_verify", False)

    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                url,
                data=body,
                headers=build_headers(settings.node_id, settings.node_secret, body),
                timeout=timeout,
                verify=verify_tls,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            last_exc = exc
            if not _is_transient_error(exc) or attempt == MAX_RETRIES - 1:
                raise
            wait = BACKOFF_BASE_SEC * (2 ** attempt)
            logger.warning(
                "Request to %s failed (attempt %d/%d): %s. Retrying in %.1fs...",
                path, attempt + 1, MAX_RETRIES, exc, wait,
            )
            time.sleep(wait)

    # Should not reach here, but satisfy type checker
    raise last_exc  # type: ignore[misc]


def send_heartbeat(settings: AgentSettings, payload: dict[str, Any]) -> dict[str, Any]:
    return post_signed_json(settings, "/api/node/heartbeat", payload, timeout=30)


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

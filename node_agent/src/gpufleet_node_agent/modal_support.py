from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.state import load_json, save_json


def _pool_state_path(settings: AgentSettings) -> Path:
    return settings.state_dir / "modal_credential_pool_state.json"


def load_modal_credential_pool(settings: AgentSettings) -> list[dict[str, Any]]:
    path = settings.resolve_agent_path(settings.modal_credentials_path)
    if path is None:
        return []
    payload = load_json(path, {})
    entries = payload.get("credentials", [])
    return entries if isinstance(entries, list) else []


def _enabled_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [entry for entry in entries if bool(entry.get("enabled", True))]


def choose_modal_credential(settings: AgentSettings, payload: dict[str, Any]) -> dict[str, Any] | None:
    entries = _enabled_entries(load_modal_credential_pool(settings))
    if not entries:
        return None

    explicit_name = str(payload.get("credential_name") or payload.get("modal_credential_name") or "").strip()
    default_name = str(settings.modal_default_credential_name or "").strip()
    wanted_name = explicit_name or default_name
    if wanted_name:
        for entry in entries:
            if str(entry.get("name", "")).strip() == wanted_name:
                return entry
        raise ValueError(f"modal credential not found: {wanted_name}")

    state = load_json(_pool_state_path(settings), {"next_index": 0})
    next_index = int(state.get("next_index", 0))
    chosen = entries[next_index % len(entries)]
    save_json(_pool_state_path(settings), {"next_index": (next_index + 1) % len(entries)})
    return chosen


def build_modal_env_overrides(settings: AgentSettings, payload: dict[str, Any]) -> tuple[dict[str, str], dict[str, Any]]:
    chosen = choose_modal_credential(settings, payload)
    env: dict[str, str] = {}
    context = {
        "credential_name": None,
        "workspace": None,
        "environment": None,
    }
    if chosen is None:
        if settings.modal_default_environment:
            env["MODAL_ENVIRONMENT"] = settings.modal_default_environment
            context["environment"] = settings.modal_default_environment
        return env, context

    token_id = str(chosen.get("token_id", "")).strip()
    token_secret = str(chosen.get("token_secret", "")).strip()
    if not token_id or not token_secret:
        raise ValueError("modal credential entry must contain token_id and token_secret")

    env["MODAL_TOKEN_ID"] = token_id
    env["MODAL_TOKEN_SECRET"] = token_secret
    if settings.modal_default_workspace and not chosen.get("workspace"):
        context["workspace"] = settings.modal_default_workspace
    if chosen.get("workspace"):
        context["workspace"] = str(chosen.get("workspace"))

    environment_name = str(
        payload.get("modal_environment")
        or chosen.get("environment")
        or settings.modal_default_environment
        or ""
    ).strip()
    if environment_name:
        env["MODAL_ENVIRONMENT"] = environment_name
        context["environment"] = environment_name

    context["credential_name"] = str(chosen.get("name", "")).strip() or None
    return env, context


def collect_modal_runtime_status(settings: AgentSettings) -> dict[str, Any]:
    entries = _enabled_entries(load_modal_credential_pool(settings))
    credentials_path = settings.resolve_agent_path(settings.modal_credentials_path)
    return {
        "deployment_mode": settings.effective_deployment_mode(),
        "modal_cli_available": bool(shutil.which("modal")),
        "credential_pool_size": len(entries),
        "default_credential_name": settings.modal_default_credential_name,
        "default_environment": settings.modal_default_environment,
        "default_workspace": settings.modal_default_workspace,
        "credentials_path": str(credentials_path) if credentials_path else None,
        "env_token_id_present": bool(os.environ.get("MODAL_TOKEN_ID")),
        "env_token_secret_present": bool(os.environ.get("MODAL_TOKEN_SECRET")),
    }

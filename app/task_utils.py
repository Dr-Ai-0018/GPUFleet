from __future__ import annotations

from pathlib import PurePath
from typing import Any


TERMINAL_TASK_STATUSES = {"succeeded", "failed", "timeout", "cancelled", "lost"}
ACTIVE_TASK_STATUSES = {"claimed", "running", "cancel_requested"}
RESULT_ACCEPTING_TASK_STATUSES = {"claimed", "running", "cancel_requested"}
TASK_EVENT_TRANSITIONS = {
    "claimed": {"claimed"},
    "running": {"claimed", "running"},
    "cancelled": {"cancel_requested", "running", "claimed"},
    "failed": {"running", "cancel_requested", "claimed"},
    "timeout": {"running", "cancel_requested", "claimed"},
    "succeeded": {"running", "cancel_requested", "claimed"},
    "lost": {"claimed", "running", "cancel_requested"},
}

DEFAULT_TIMEOUT_BY_TYPE = {
    "health_check": 300,
    "git_pull": 600,
    "pip_install": 1200,
    "download_file": 900,
    "upload_and_unpack": 1800,
    "start_training": 21600,
    "modal_command": 7200,
}

DANGEROUS_COMMAND_SNIPPETS = [
    "shutdown",
    "reboot",
    "systemctl",
    "service ",
    "sc.exe",
    "net stop",
    "net start",
    "mkfs",
    "fdisk",
    "useradd",
    "usermod",
    "passwd",
    "sudo ",
    "runas ",
]


def detect_dangerous_command(task_type: str, payload: dict[str, Any]) -> str | None:
    if task_type not in {"shell", "python_script", "modal_command"}:
        return None

    command_parts = []
    for key in ("command", "script", "args", "entrypoint"):
        value = payload.get(key)
        if isinstance(value, str):
            command_parts.append(value.lower())
        elif isinstance(value, list):
            command_parts.extend(str(item).lower() for item in value)

    command_text = " ".join(command_parts)
    for snippet in DANGEROUS_COMMAND_SNIPPETS:
        if snippet in command_text:
            return snippet
    return None


def ensure_workdir_allowed(workdir: str | None, allowed_workdirs: list[str]) -> bool:
    if not workdir:
        return True
    if not allowed_workdirs:
        return True

    target = PurePath(workdir)
    target_parts = target.parts
    for allowed in allowed_workdirs:
        allowed_path = PurePath(allowed)
        allowed_parts = allowed_path.parts
        if len(target_parts) >= len(allowed_parts) and target_parts[: len(allowed_parts)] == allowed_parts:
            return True
    return False


def normalize_timeout(task_type: str, timeout_sec: int | None) -> int:
    if timeout_sec is not None:
        return timeout_sec
    return DEFAULT_TIMEOUT_BY_TYPE.get(task_type, 3600)

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from gpufleet_node_agent.api_client import send_task_log_chunk as _default_send_task_log_chunk
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.state import load_json, save_json

LOG_CHUNK_SIZE = 3500


def _compat_attr(name: str, default: Any) -> Any:
    module = sys.modules.get("gpufleet_node_agent.task_runner")
    return getattr(module, name, default) if module is not None else default


def log_offsets_path(settings: AgentSettings) -> Path:
    return settings.state_dir / "log_offsets.json"


def load_log_offsets(settings: AgentSettings) -> dict[str, Any]:
    return load_json(log_offsets_path(settings), {})


def save_log_offsets(settings: AgentSettings, data: dict[str, Any]) -> None:
    save_json(log_offsets_path(settings), data)


def init_log_offsets(settings: AgentSettings, task_id: str) -> None:
    offsets = load_log_offsets(settings)
    offsets.setdefault(task_id, {})
    offsets[task_id].setdefault("stdout", {"acked_offset": 0})
    offsets[task_id].setdefault("stderr", {"acked_offset": 0})
    save_log_offsets(settings, offsets)


def acked_log_offset(settings: AgentSettings, task_id: str, stream: str) -> int:
    offsets = load_log_offsets(settings)
    return int(offsets.get(task_id, {}).get(stream, {}).get("acked_offset", 0))


def store_acked_log_offset(settings: AgentSettings, task_id: str, stream: str, acked_offset: int) -> None:
    offsets = load_log_offsets(settings)
    offsets.setdefault(task_id, {})
    offsets[task_id].setdefault(stream, {})
    offsets[task_id][stream]["acked_offset"] = int(acked_offset)
    save_log_offsets(settings, offsets)


def clear_log_offsets(settings: AgentSettings, task_id: str) -> None:
    offsets = load_log_offsets(settings)
    if task_id in offsets:
        offsets.pop(task_id, None)
        save_log_offsets(settings, offsets)


def send_log_chunks_with_ack(settings: AgentSettings, task_id: str, stream: str, text: str, *, start_offset: int, final: bool) -> int:
    send_task_log_chunk = _compat_attr("send_task_log_chunk", _default_send_task_log_chunk)
    offset = start_offset
    if not text:
        if final:
            send_task_log_chunk(settings, {"task_id": task_id, "stream": stream, "offset_start": start_offset, "text": "", "is_final": True})
            store_acked_log_offset(settings, task_id, stream, start_offset)
        return start_offset
    relative_offset = 0
    while relative_offset < len(text):
        chunk = text[relative_offset : relative_offset + LOG_CHUNK_SIZE]
        send_task_log_chunk(settings, {"task_id": task_id, "stream": stream, "offset_start": offset, "text": chunk, "is_final": final and relative_offset + len(chunk) >= len(text)})
        offset += len(chunk)
        relative_offset += len(chunk)
        store_acked_log_offset(settings, task_id, stream, offset)
    return offset


def read_text_slice(path: Path, offset: int) -> tuple[str, int]:
    if not path.exists():
        return "", offset
    text = path.read_text(encoding="utf-8", errors="replace")
    if offset >= len(text):
        return "", len(text)
    return text[offset:], len(text)


def upload_incremental_logs(settings: AgentSettings, state: dict[str, Any], *, final: bool = False) -> dict[str, Any]:
    init_log_offsets(settings, state["task_id"])
    for stream in ("stdout", "stderr"):
        path_value = state.get(f"{stream}_path")
        if not path_value:
            continue
        path = Path(path_value)
        offset_key = f"{stream}_offset"
        previous_offset = acked_log_offset(settings, state["task_id"], stream)
        text, new_offset = read_text_slice(path, previous_offset)
        acked_offset = send_log_chunks_with_ack(settings, state["task_id"], stream, text, start_offset=previous_offset, final=final) if (text or final) else previous_offset
        state[offset_key] = acked_offset if text else new_offset
    save_json(settings.state_dir / "current_task.json", state)
    return state


def upload_log_text(settings: AgentSettings, task_id: str, stream: str, text: str) -> None:
    init_log_offsets(settings, task_id)
    try:
        send_log_chunks_with_ack(settings, task_id, stream, text, start_offset=0, final=True)
    finally:
        clear_log_offsets(settings, task_id)

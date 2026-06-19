from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from gpufleet_node_agent.api_client import (
    send_artifact_file as _default_send_artifact_file,
    send_task_event as _default_send_task_event,
    send_task_result as _default_send_task_result,
)
from gpufleet_node_agent.collect import get_boot_id
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.modal_support import build_modal_env_overrides
from gpufleet_node_agent.runner.artifact import build_result_summary, now_iso, prepare_run_dir, resolve_workdir
from gpufleet_node_agent.runner.executor import ACTIVE_PROCESSES, build_command, build_env, pid_exists, process_group_popen_kwargs, terminate_process_tree
from gpufleet_node_agent.runner.log_pump import clear_log_offsets, init_log_offsets, upload_incremental_logs
from gpufleet_node_agent.state import load_json, save_json


def _compat_attr(name: str, default: Any) -> Any:
    module = sys.modules.get("gpufleet_node_agent.task_runner")
    return getattr(module, name, default) if module is not None else default


def set_current_task(settings: AgentSettings, payload: dict[str, Any]) -> None:
    save_json(settings.state_dir / "current_task.json", payload)


def clear_current_task(settings: AgentSettings) -> None:
    save_json(settings.state_dir / "current_task.json", {})


def has_active_task(settings: AgentSettings) -> bool:
    return bool(load_json(settings.state_dir / "current_task.json", {}).get("task_id"))


def load_current_task(settings: AgentSettings) -> dict[str, Any]:
    return load_json(settings.state_dir / "current_task.json", {})


def start_background_task(settings: AgentSettings, task: dict[str, Any]) -> dict[str, Any]:
    send_task_event = _compat_attr("send_task_event", _default_send_task_event)
    task_id = task["task_id"]
    boot_id = get_boot_id(settings)
    started_at = now_iso()
    run_dir = prepare_run_dir(settings, task_id)
    workdir = resolve_workdir(settings, task, run_dir)
    workdir.mkdir(parents=True, exist_ok=True)
    modal_context = {}
    modal_env, modal_context = build_modal_env_overrides(settings, task.get("payload", {})) if task.get("type") == "modal_command" else ({}, {})
    env = build_env(settings, task, run_dir, modal_env_overrides=modal_env)
    command, inline_script_path, execution_env_overrides, execution_summary = build_command(settings, task, run_dir, workdir)
    env.update(execution_env_overrides)
    stdout_path = run_dir / "stdout.log"
    stderr_path = run_dir / "stderr.log"
    stdout_path.write_text("", encoding="utf-8")
    stderr_path.write_text("", encoding="utf-8")
    save_json(run_dir / "task_metadata.json", {"task_id": task_id, "type": task["type"], "started_at": started_at, "run_dir": str(run_dir), "workdir": str(workdir), "command": command, "inline_script_path": inline_script_path, "execution": execution_summary, "modal_context": modal_context})
    send_task_event(settings, {"task_id": task_id, "event": "running", "boot_id": boot_id, "detail": {"run_dir": str(run_dir), "workdir": str(workdir)}})
    stdout_handle = stdout_path.open("w", encoding="utf-8", errors="replace")
    stderr_handle = stderr_path.open("w", encoding="utf-8", errors="replace")
    try:
        process = subprocess.Popen(command, cwd=str(workdir), env=env, stdout=stdout_handle, stderr=stderr_handle, text=True, encoding="utf-8", errors="replace", **process_group_popen_kwargs())
    finally:
        stdout_handle.close()
        stderr_handle.close()
    ACTIVE_PROCESSES[task_id] = process
    init_log_offsets(settings, task_id)
    state = {"task_id": task_id, "type": task["type"], "pid": process.pid, "started_at": started_at, "boot_id": boot_id, "run_dir": str(run_dir), "workdir": str(workdir), "command": command, "timeout_sec": int(task.get("timeout_sec", 3600)), "kill_grace_sec": int(task.get("kill_grace_sec", 15)), "execution": execution_summary, "modal_context": modal_context, "stdout_path": str(stdout_path), "stderr_path": str(stderr_path), "stdout_offset": 0, "stderr_offset": 0, "cancel_requested": False}
    set_current_task(settings, state)
    return state


def finalize_background_task(settings: AgentSettings, state: dict[str, Any], *, final_status: str, exit_code: int | None) -> dict[str, Any]:
    send_task_result = _compat_attr("send_task_result", _default_send_task_result)
    send_artifact_file = _compat_attr("send_artifact_file", _default_send_artifact_file)
    finished_at = now_iso()
    state = upload_incremental_logs(settings, state, final=True)
    stdout_text = Path(state["stdout_path"]).read_text(encoding="utf-8", errors="replace") if state.get("stdout_path") else ""
    stderr_text = Path(state["stderr_path"]).read_text(encoding="utf-8", errors="replace") if state.get("stderr_path") else ""
    result_summary = build_result_summary({"type": state.get("type"), "modal_context": state.get("modal_context", {})}, Path(state.get("run_dir") or "."), Path(state.get("workdir") or "."), list(state.get("command", [])), stdout_text, stderr_text)
    result_summary["execution"] = state.get("execution", {"backend": "default"})
    send_task_result(settings, {"task_id": state["task_id"], "final_status": final_status, "exit_code": exit_code, "summary": result_summary, "boot_id": state.get("boot_id"), "pid": state.get("pid"), "pgid_or_job_id": str(state.get("pid")) if state.get("pid") else None, "started_at": state.get("started_at"), "finished_at": finished_at})
    send_artifact_file(settings, task_id=state["task_id"], artifact_name="result_summary.json", artifact_type="task_summary", artifact_bytes=json.dumps({"task_id": state["task_id"], "type": state.get("type"), "final_status": final_status, "exit_code": exit_code, "started_at": state.get("started_at"), "finished_at": finished_at, "run_dir": state.get("run_dir"), "stdout_bytes": len(stdout_text.encode("utf-8")), "stderr_bytes": len(stderr_text.encode("utf-8"))}, ensure_ascii=False, indent=2).encode("utf-8"), content_type="application/json", preview={"final_status": final_status, "exit_code": exit_code})
    ACTIVE_PROCESSES.pop(state["task_id"], None)
    clear_log_offsets(settings, state["task_id"])
    clear_current_task(settings)
    return {"task_id": state["task_id"], "final_status": final_status, "exit_code": exit_code}


def start_tasks_background(settings: AgentSettings, tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if has_active_task(settings):
        return []
    return [{"task_id": start_background_task(settings, task)["task_id"], "status": "running"} for task in tasks[:1]]


def sync_active_task(settings: AgentSettings, task_controls: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    state = load_current_task(settings)
    if not state.get("task_id"):
        return None
    task_id = state["task_id"]
    process = ACTIVE_PROCESSES.get(task_id)
    if process is None:
        return None
    should_cancel = any(item.get("task_id") == task_id and item.get("action") == "cancel" for item in (task_controls or []))
    if should_cancel and not state.get("cancel_requested"):
        state["cancel_requested"] = True
        save_json(settings.state_dir / "current_task.json", state)
        terminate_process_tree(process, int(state.get("kill_grace_sec", 15)))
    state = upload_incremental_logs(settings, state, final=False)
    started_raw = state.get("started_at")
    started_at = datetime.fromisoformat(str(started_raw).replace("Z", "+00:00")) if started_raw else datetime.now(UTC)
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=UTC)
    if process.poll() is None and (datetime.now(UTC) - started_at).total_seconds() > int(state.get("timeout_sec", 3600)):
        terminate_process_tree(process, int(state.get("kill_grace_sec", 15)))
        state["timed_out"] = True
        save_json(settings.state_dir / "current_task.json", state)
    return_code = process.poll()
    if return_code is None:
        return {"task_id": task_id, "status": "running"}
    if state.get("cancel_requested"):
        return finalize_background_task(settings, state, final_status="cancelled", exit_code=return_code)
    if state.get("timed_out"):
        return finalize_background_task(settings, state, final_status="timeout", exit_code=return_code)
    return finalize_background_task(settings, state, final_status="succeeded" if return_code == 0 else "failed", exit_code=0 if return_code == 0 else return_code)


def recover_orphaned_task(settings: AgentSettings) -> dict[str, Any] | None:
    compat_pid_exists = _compat_attr("_pid_exists", pid_exists)
    state = load_current_task(settings)
    task_id = state.get("task_id")
    if not task_id or task_id in ACTIVE_PROCESSES:
        return None
    process_alive = compat_pid_exists(int(state.get("pid")) if state.get("pid") else None)
    state = upload_incremental_logs(settings, state, final=True)
    if process_alive:
        final_status, exit_code = "lost", None
        state["recovery_note"] = "agent restarted while task process was still alive; reattach not supported in MVP"
    elif state.get("cancel_requested"):
        final_status, exit_code = "cancelled", None
        state["recovery_note"] = "agent recovered a previously cancelled task without live process handle"
    elif state.get("timed_out"):
        final_status, exit_code = "timeout", None
        state["recovery_note"] = "agent recovered a timed-out task without live process handle"
    else:
        final_status, exit_code = "failed", None
        state["recovery_note"] = "agent recovered an orphaned task after restart; exit code unavailable"
    save_json(settings.state_dir / "current_task.json", state)
    return finalize_background_task(settings, state, final_status=final_status, exit_code=exit_code)

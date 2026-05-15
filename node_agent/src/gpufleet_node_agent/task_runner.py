from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from gpufleet_node_agent.api_client import (
    send_artifact_file,
    send_task_event,
    send_task_log_chunk,
    send_task_result,
)
from gpufleet_node_agent.collect import get_boot_id
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.state import save_json


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _safe_task_name(task_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in task_id)


def _prepare_run_dir(settings: AgentSettings, task_id: str) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = settings.runs_dir / f"{timestamp}_{_safe_task_name(task_id)}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def _resolve_workdir(settings: AgentSettings, task: dict[str, Any], run_dir: Path) -> Path:
    workdir = task.get("workdir")
    if workdir:
        return Path(workdir)
    return run_dir


def _build_env(settings: AgentSettings, task: dict[str, Any], run_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update({str(key): str(value) for key, value in task.get("env", {}).items()})
    env.setdefault("GPUFLEET_TASK_ID", task["task_id"])
    env.setdefault("GPUFLEET_RUN_DIR", str(run_dir))
    env.setdefault("GPUFLEET_AGENT_ROOT", str(settings.agent_root.resolve()))
    if task.get("requested_gpu_ids"):
        env.setdefault("CUDA_VISIBLE_DEVICES", ",".join(str(item) for item in task["requested_gpu_ids"]))
    return env


def _build_command(settings: AgentSettings, task: dict[str, Any], run_dir: Path) -> tuple[list[str], Path | None]:
    task_type = task["type"]
    payload = task.get("payload", {})
    if task_type == "health_check":
        command = [
            settings.python_executable or sys.executable,
            "-c",
            (
                "import json,os,platform,sys;"
                "print(json.dumps({"
                "'ok': True,"
                "'python': sys.version.split()[0],"
                "'executable': sys.executable,"
                "'cwd': os.getcwd(),"
                "'platform': platform.platform()"
                "}, ensure_ascii=False))"
            ),
        ]
        return command, None

    if task_type == "shell":
        command_text = str(payload.get("command", "")).strip()
        if not command_text:
            raise ValueError("shell task missing payload.command")
        if os.name == "nt":
            shell_exe = shutil.which("pwsh") or shutil.which("powershell") or "powershell"
            return [shell_exe, "-NoProfile", "-Command", command_text], None
        return ["/bin/bash", "-lc", command_text], None

    if task_type == "python_script":
        script_text = str(payload.get("script", "")).strip()
        if not script_text:
            raise ValueError("python_script task missing payload.script")
        script_path = run_dir / "inline_task.py"
        script_path.write_text(script_text + "\n", encoding="utf-8")
        return [settings.python_executable or sys.executable, str(script_path)], script_path

    raise ValueError(f"Unsupported task type for node agent MVP: {task_type}")


def _write_local_logs(run_dir: Path, stdout_text: str, stderr_text: str) -> None:
    (run_dir / "stdout.log").write_text(stdout_text, encoding="utf-8")
    (run_dir / "stderr.log").write_text(stderr_text, encoding="utf-8")


def _upload_log_text(settings: AgentSettings, task_id: str, stream: str, text: str) -> None:
    offset = 0
    chunk_size = 3500
    if not text:
        send_task_log_chunk(
            settings,
            {
                "task_id": task_id,
                "stream": stream,
                "offset_start": 0,
                "text": "",
                "is_final": True,
            },
        )
        return

    while offset < len(text):
        chunk = text[offset : offset + chunk_size]
        send_task_log_chunk(
            settings,
            {
                "task_id": task_id,
                "stream": stream,
                "offset_start": offset,
                "text": chunk,
                "is_final": offset + len(chunk) >= len(text),
            },
        )
        offset += len(chunk)


def _set_current_task(settings: AgentSettings, payload: dict[str, Any]) -> None:
    save_json(settings.state_dir / "current_task.json", payload)


def _clear_current_task(settings: AgentSettings) -> None:
    save_json(settings.state_dir / "current_task.json", {})


def execute_task(settings: AgentSettings, task: dict[str, Any]) -> dict[str, Any]:
    task_id = task["task_id"]
    boot_id = get_boot_id(settings)
    started_at = _now_iso()
    run_dir = _prepare_run_dir(settings, task_id)
    stdout_text = ""
    stderr_text = ""
    final_status = "failed"
    exit_code: int | None = None
    finished_at = _now_iso()
    process: subprocess.Popen[str] | None = None
    command: list[str] = []
    workdir = run_dir
    try:
        workdir = _resolve_workdir(settings, task, run_dir)
        workdir.mkdir(parents=True, exist_ok=True)
        env = _build_env(settings, task, run_dir)

        command, inline_script_path = _build_command(settings, task, run_dir)
        metadata = {
            "task_id": task_id,
            "type": task["type"],
            "started_at": started_at,
            "run_dir": str(run_dir),
            "workdir": str(workdir),
            "command": command,
            "inline_script_path": str(inline_script_path) if inline_script_path else None,
        }
        save_json(run_dir / "task_metadata.json", metadata)

        send_task_event(
            settings,
            {
                "task_id": task_id,
                "event": "running",
                "boot_id": boot_id,
                "detail": {"run_dir": str(run_dir), "workdir": str(workdir)},
            },
        )

        process = subprocess.Popen(
            command,
            cwd=str(workdir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        _set_current_task(
            settings,
            {
                "task_id": task_id,
                "pid": process.pid,
                "started_at": started_at,
                "run_dir": str(run_dir),
            },
        )

        stdout_text, stderr_text = process.communicate(timeout=task.get("timeout_sec", 3600))
        exit_code = process.returncode
        finished_at = _now_iso()
        final_status = "succeeded" if exit_code == 0 else "failed"
    except subprocess.TimeoutExpired:
        if process is not None:
            process.kill()
            stdout_text, stderr_text = process.communicate()
        finished_at = _now_iso()
        final_status = "timeout"
        exit_code = None
    except Exception as exc:
        finished_at = _now_iso()
        final_status = "failed"
        stderr_text = f"{type(exc).__name__}: {exc}\n"
    finally:
        _write_local_logs(run_dir, stdout_text, stderr_text)
        _upload_log_text(settings, task_id, "stdout", stdout_text)
        _upload_log_text(settings, task_id, "stderr", stderr_text)
        _clear_current_task(settings)

    result_summary = {
        "run_dir": str(run_dir),
        "workdir": str(workdir),
        "command": command,
        "stdout_preview": stdout_text[-500:] if stdout_text else "",
        "stderr_preview": stderr_text[-500:] if stderr_text else "",
    }
    send_task_result(
        settings,
        {
            "task_id": task_id,
            "final_status": final_status,
            "exit_code": exit_code,
            "summary": result_summary,
            "boot_id": boot_id,
            "pid": process.pid if process is not None else None,
            "pgid_or_job_id": str(process.pid) if process is not None else None,
            "started_at": started_at,
            "finished_at": finished_at,
        },
    )

    artifact_summary = {
        "task_id": task_id,
        "type": task["type"],
        "final_status": final_status,
        "exit_code": exit_code,
        "started_at": started_at,
        "finished_at": finished_at,
        "run_dir": str(run_dir),
        "stdout_bytes": len(stdout_text.encode("utf-8")),
        "stderr_bytes": len(stderr_text.encode("utf-8")),
    }
    send_artifact_file(
        settings,
        task_id=task_id,
        artifact_name="result_summary.json",
        artifact_type="task_summary",
        artifact_bytes=json.dumps(artifact_summary, ensure_ascii=False, indent=2).encode("utf-8"),
        content_type="application/json",
        preview={"final_status": final_status, "exit_code": exit_code},
    )
    return {"task_id": task_id, "final_status": final_status, "exit_code": exit_code}


def execute_tasks(settings: AgentSettings, tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for task in tasks:
        results.append(execute_task(settings, task))
    return results

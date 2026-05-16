from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from gpufleet_node_agent.api_client import (
    send_artifact_file,
    send_task_event,
    send_task_log_chunk,
    send_task_result,
)
from gpufleet_node_agent.collect import (
    collect_cpu,
    collect_disks,
    collect_gpus,
    collect_memory,
    collect_nvidia,
    collect_python_env,
    get_boot_id,
)
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.modal_support import build_modal_env_overrides, collect_modal_runtime_status
from gpufleet_node_agent.state import load_json, save_json


ACTIVE_PROCESSES: dict[str, subprocess.Popen[str]] = {}


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


def _build_env(
    settings: AgentSettings,
    task: dict[str, Any],
    run_dir: Path,
    *,
    modal_env_overrides: dict[str, str] | None = None,
) -> dict[str, str]:
    env = os.environ.copy()
    env.update({str(key): str(value) for key, value in task.get("env", {}).items()})
    env.setdefault("GPUFLEET_TASK_ID", task["task_id"])
    env.setdefault("GPUFLEET_RUN_DIR", str(run_dir))
    env.setdefault("GPUFLEET_AGENT_ROOT", str(settings.agent_root.resolve()))
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PYTHONUTF8", "1")
    if task.get("requested_gpu_ids"):
        env.setdefault("CUDA_VISIBLE_DEVICES", ",".join(str(item) for item in task["requested_gpu_ids"]))
    if task.get("type") == "modal_command":
        env.update(modal_env_overrides or {})
    return env


def _task_extra_roots(task: dict[str, Any]) -> list[str]:
    return [str(task.get("workdir"))] if task.get("workdir") else []


def _build_modal_command(settings: AgentSettings, task: dict[str, Any], workdir: Path) -> list[str]:
    payload = task.get("payload", {})
    extra_roots = _task_extra_roots(task)
    modal_exe = shutil.which("modal")
    if not modal_exe:
        raise ValueError("modal CLI not found on this node")

    raw_command = str(payload.get("command", "")).strip()
    if raw_command:
        if os.name == "nt":
            shell_exe = shutil.which("pwsh") or shutil.which("powershell") or "powershell"
            return [shell_exe, "-NoProfile", "-Command", raw_command]
        return ["/bin/bash", "-lc", raw_command]

    script_path = payload.get("script_path")
    module_path = payload.get("module_path")
    entrypoint = str(payload.get("entrypoint", "")).strip()
    args = payload.get("args", [])
    if args is not None and not isinstance(args, list):
        raise ValueError("modal_command payload.args must be a list")

    command = [modal_exe, "run"]
    if payload.get("detach"):
        command.append("--detach")
    if payload.get("interactive"):
        command.append("--interactive")
    if payload.get("quiet"):
        command.append("--quiet")
    if payload.get("timestamps"):
        command.append("--timestamps")

    modal_env = str(payload.get("modal_env", "")).strip()
    if modal_env:
        command.extend(["--env", modal_env])

    write_result_path = payload.get("write_result_path")
    if write_result_path:
        raw_result_path = Path(str(write_result_path))
        if not raw_result_path.is_absolute():
            raw_result_path = workdir / raw_result_path
        result_path = _resolve_safe_path(settings, str(raw_result_path), extra_roots=extra_roots)
        result_path.parent.mkdir(parents=True, exist_ok=True)
        command.extend(["--write-result", str(result_path)])

    if module_path:
        command.append("-m")
        target_ref = str(module_path).strip()
        if not target_ref:
            raise ValueError("modal_command payload.module_path must not be empty")
    elif script_path:
        raw_script_path = Path(str(script_path))
        if not raw_script_path.is_absolute():
            raw_script_path = workdir / raw_script_path
        script_ref = _resolve_safe_path(settings, str(raw_script_path), allow_missing=False, extra_roots=extra_roots)
        target_ref = str(script_ref)
    else:
        raise ValueError("modal_command requires payload.command or payload.script_path/module_path")

    if entrypoint:
        target_ref = f"{target_ref}::{entrypoint}"

    command.append(target_ref)
    command.extend(str(item) for item in (args or []))
    return command


def _build_command(settings: AgentSettings, task: dict[str, Any], run_dir: Path, workdir: Path) -> tuple[list[str], Path | None]:
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

    if task_type == "pip_install":
        packages = payload.get("packages")
        if not isinstance(packages, list) or not packages:
            raise ValueError("pip_install task requires non-empty payload.packages")
        extra_args = payload.get("extra_args", [])
        if extra_args is not None and not isinstance(extra_args, list):
            raise ValueError("pip_install payload.extra_args must be a list")
        package_values = [str(item) for item in packages]
        normalized_extra_args = [str(item) for item in (extra_args or [])]
        if any(Path(item).exists() for item in package_values):
            if "--no-build-isolation" not in normalized_extra_args:
                normalized_extra_args.append("--no-build-isolation")
        return [
            settings.python_executable or sys.executable,
            "-m",
            "pip",
            "install",
            *package_values,
            *normalized_extra_args,
        ], None

    if task_type == "git_pull":
        repo_url = str(payload.get("repo_url", "")).strip()
        repo_dir = payload.get("repo_dir")
        if not repo_url or not repo_dir:
            raise ValueError("git_pull task requires payload.repo_url and payload.repo_dir")
        repo_path = _resolve_safe_path(
            settings,
            str(repo_dir),
            extra_roots=[str(task.get("workdir"))] if task.get("workdir") else [],
        )
        branch = str(payload.get("branch", "")).strip()
        if not repo_path.exists() or not (repo_path / ".git").exists():
            clone_cmd = ["git", "clone", repo_url, str(repo_path)]
            if branch:
                clone_cmd = ["git", "clone", "--branch", branch, repo_url, str(repo_path)]
            return clone_cmd, None
        if branch:
            return ["git", "-C", str(repo_path), "pull", "origin", branch], None
        return ["git", "-C", str(repo_path), "pull"], None

    if task_type == "modal_command":
        return _build_modal_command(settings, task, workdir), None

    raise ValueError(f"Unsupported task type for node agent MVP: {task_type}")


def _allowed_roots(settings: AgentSettings, extra_roots: list[str] | None = None) -> list[Path]:
    roots = [settings.agent_root.resolve()]
    for path in (settings.repos_dir, settings.runs_dir, settings.artifacts_dir, settings.logs_dir, settings.state_dir):
        roots.append(path.resolve())
    for extra in extra_roots or []:
        roots.append(Path(extra).resolve(strict=False))
    return roots


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False


def _resolve_safe_path(
    settings: AgentSettings,
    raw_path: str,
    *,
    allow_missing: bool = True,
    extra_roots: list[str] | None = None,
) -> Path:
    candidate = Path(raw_path)
    resolved = candidate.resolve(strict=False) if allow_missing else candidate.resolve()
    if not any(_is_within(resolved, root) for root in _allowed_roots(settings, extra_roots)):
        raise ValueError(f"path outside allowed roots: {raw_path}")
    return resolved


def _execute_native_task(settings: AgentSettings, task: dict[str, Any], run_dir: Path) -> dict[str, Any] | None:
    task_type = task["type"]
    payload = task.get("payload", {})
    extra_roots = _task_extra_roots(task)
    if task_type == "health_check":
        return {
            "ok": True,
            "deployment_mode": settings.deployment_mode,
            "effective_deployment_mode": settings.effective_deployment_mode(),
            "cpu": collect_cpu(),
            "memory": collect_memory(),
            "disks": collect_disks(settings),
            "gpus": collect_gpus(),
            "nvidia": collect_nvidia(),
            "python_env": collect_python_env(settings),
            "modal_runtime": collect_modal_runtime_status(settings),
        }
    if task_type == "file_mkdir":
        target = _resolve_safe_path(settings, str(payload["path"]), extra_roots=extra_roots)
        target.mkdir(parents=True, exist_ok=True)
        return {"path": str(target), "created": True}

    if task_type == "file_write":
        target = _resolve_safe_path(settings, str(payload["path"]), extra_roots=extra_roots)
        target.parent.mkdir(parents=True, exist_ok=True)
        content = str(payload.get("content", ""))
        target.write_text(content, encoding=str(payload.get("encoding", "utf-8")))
        return {"path": str(target), "bytes": len(content.encode("utf-8"))}

    if task_type == "file_patch_text":
        target = _resolve_safe_path(settings, str(payload["path"]), allow_missing=False, extra_roots=extra_roots)
        source = target.read_text(encoding=str(payload.get("encoding", "utf-8")))
        old_text = str(payload.get("old_text", ""))
        new_text = str(payload.get("new_text", ""))
        if old_text not in source:
            raise ValueError("old_text not found in file")
        updated = source.replace(old_text, new_text, 1 if not payload.get("replace_all") else -1)
        target.write_text(updated, encoding=str(payload.get("encoding", "utf-8")))
        return {"path": str(target), "replaced": True}

    if task_type == "file_move":
        source = _resolve_safe_path(settings, str(payload["source"]), allow_missing=False, extra_roots=extra_roots)
        target = _resolve_safe_path(settings, str(payload["target"]), extra_roots=extra_roots)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))
        return {"source": str(source), "target": str(target)}

    if task_type == "file_delete":
        target = _resolve_safe_path(settings, str(payload["path"]), allow_missing=False, extra_roots=extra_roots)
        if target.is_dir():
            shutil.rmtree(target)
            kind = "directory"
        else:
            target.unlink()
            kind = "file"
        return {"path": str(target), "deleted": kind}

    if task_type == "file_extract":
        archive = _resolve_safe_path(settings, str(payload["archive_path"]), allow_missing=False, extra_roots=extra_roots)
        target_dir = _resolve_safe_path(settings, str(payload["target_dir"]), extra_roots=extra_roots)
        target_dir.mkdir(parents=True, exist_ok=True)
        if archive.suffix.lower() == ".zip":
            with zipfile.ZipFile(archive, "r") as zf:
                zf.extractall(target_dir)
        else:
            raise ValueError("only .zip archives are supported in MVP")
        return {"archive_path": str(archive), "target_dir": str(target_dir)}

    if task_type == "file_preview":
        target = _resolve_safe_path(settings, str(payload["path"]), allow_missing=False, extra_roots=extra_roots)
        if target.is_dir():
            entries = []
            for item in sorted(target.iterdir(), key=lambda path: path.name.lower())[: int(payload.get("limit", 50))]:
                entries.append(
                    {
                        "name": item.name,
                        "is_dir": item.is_dir(),
                        "size_bytes": item.stat().st_size if item.is_file() else None,
                    }
                )
            preview_bytes = json.dumps({"path": str(target), "entries": entries}, ensure_ascii=False, indent=2).encode("utf-8")
            send_artifact_file(
                settings,
                task_id=task["task_id"],
                artifact_name="file_preview.json",
                artifact_type="file_preview",
                artifact_bytes=preview_bytes,
                content_type="application/json",
                preview={"path": str(target), "entry_count": len(entries)},
            )
            return {"path": str(target), "entry_count": len(entries)}
        text = target.read_text(encoding=str(payload.get("encoding", "utf-8")), errors="replace")
        max_chars = int(payload.get("max_chars", 4000))
        preview_text = text[:max_chars]
        send_artifact_file(
            settings,
            task_id=task["task_id"],
            artifact_name=f"{target.name}.preview.txt",
            artifact_type="file_preview",
            artifact_bytes=preview_text.encode("utf-8"),
            content_type="text/plain",
            preview={"path": str(target), "chars": len(preview_text)},
        )
        return {"path": str(target), "chars": len(preview_text)}

    if task_type == "upload_and_unpack":
        archive = _resolve_safe_path(settings, str(payload["archive_path"]), allow_missing=False, extra_roots=extra_roots)
        target_dir = _resolve_safe_path(settings, str(payload["target_dir"]), extra_roots=extra_roots)
        target_dir.mkdir(parents=True, exist_ok=True)
        if archive.suffix.lower() == ".zip":
            with zipfile.ZipFile(archive, "r") as zf:
                zf.extractall(target_dir)
        else:
            raise ValueError("only .zip archives are supported in MVP")
        return {"archive_path": str(archive), "target_dir": str(target_dir), "unpacked": True}

    if task_type == "download_file":
        url = str(payload.get("url", "")).strip()
        target_path_raw = payload.get("target_path")
        if not url or not target_path_raw:
            raise ValueError("download_file task requires payload.url and payload.target_path")
        target_path = _resolve_safe_path(settings, str(target_path_raw), extra_roots=extra_roots)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=int(payload.get("timeout_sec", 60))) as response:
            content = response.read()
            content_type = response.headers.get("Content-Type")
        target_path.write_bytes(content)
        preview = {
            "url": url,
            "target_path": str(target_path),
            "size_bytes": len(content),
            "content_type": content_type,
        }
        send_artifact_file(
            settings,
            task_id=task["task_id"],
            artifact_name=f"{target_path.name}.download.json",
            artifact_type="download_summary",
            artifact_bytes=json.dumps(preview, ensure_ascii=False, indent=2).encode("utf-8"),
            content_type="application/json",
            preview=preview,
        )
        return preview

    return None


def _write_local_logs(run_dir: Path, stdout_text: str, stderr_text: str) -> None:
    (run_dir / "stdout.log").write_text(stdout_text, encoding="utf-8")
    (run_dir / "stderr.log").write_text(stderr_text, encoding="utf-8")


def _build_result_summary(task: dict[str, Any], run_dir: Path, workdir: Path, command: list[str], stdout_text: str, stderr_text: str) -> dict[str, Any]:
    combined = "\n".join(part for part in [stdout_text, stderr_text] if part)
    modal_app_urls = re.findall(r"https://modal\.com/apps/\S+", combined)
    cache_hit_count = combined.count("cache hit")
    return {
        "run_dir": str(run_dir),
        "workdir": str(workdir),
        "command": command,
        "stdout_preview": stdout_text[-500:] if stdout_text else "",
        "stderr_preview": stderr_text[-500:] if stderr_text else "",
        "modal": {
            "app_urls": modal_app_urls,
            "cache_hit_count": cache_hit_count,
            "credential_name": task.get("modal_context", {}).get("credential_name"),
            "workspace": task.get("modal_context", {}).get("workspace"),
            "environment": task.get("modal_context", {}).get("environment"),
        } if task.get("type") == "modal_command" else None,
    }


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


def has_active_task(settings: AgentSettings) -> bool:
    state = load_json(settings.state_dir / "current_task.json", {})
    return bool(state.get("task_id"))


def _load_current_task(settings: AgentSettings) -> dict[str, Any]:
    return load_json(settings.state_dir / "current_task.json", {})


def _read_text_slice(path: Path, offset: int) -> tuple[str, int]:
    if not path.exists():
        return "", offset
    text = path.read_text(encoding="utf-8", errors="replace")
    if offset >= len(text):
        return "", len(text)
    return text[offset:], len(text)


def _upload_incremental_logs(settings: AgentSettings, state: dict[str, Any], *, final: bool = False) -> dict[str, Any]:
    for stream in ("stdout", "stderr"):
        path_value = state.get(f"{stream}_path")
        if not path_value:
            continue
        path = Path(path_value)
        offset_key = f"{stream}_offset"
        previous_offset = int(state.get(offset_key, 0))
        text, new_offset = _read_text_slice(path, previous_offset)
        if text or final:
            send_task_log_chunk(
                settings,
                {
                    "task_id": state["task_id"],
                    "stream": stream,
                    "offset_start": previous_offset,
                    "text": text,
                    "is_final": final,
                },
            )
        state[offset_key] = new_offset
    save_json(settings.state_dir / "current_task.json", state)
    return state


def _terminate_process_tree(process: subprocess.Popen[str], grace_sec: int) -> None:
    if os.name == "nt":
        process.terminate()
        try:
            process.wait(timeout=max(grace_sec, 1))
        except subprocess.TimeoutExpired:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                text=True,
                check=False,
            )
            process.wait(timeout=10)
    else:
        process.terminate()
        try:
            process.wait(timeout=max(grace_sec, 1))
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)


def _pid_exists(pid: int | None) -> bool:
    if not pid:
        return False
    if os.name == "nt":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        return str(pid) in result.stdout
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _start_background_task(settings: AgentSettings, task: dict[str, Any]) -> dict[str, Any]:
    task_id = task["task_id"]
    boot_id = get_boot_id(settings)
    started_at = _now_iso()
    run_dir = _prepare_run_dir(settings, task_id)
    workdir = _resolve_workdir(settings, task, run_dir)
    workdir.mkdir(parents=True, exist_ok=True)
    modal_context = {}
    modal_env: dict[str, str] = {}
    if task.get("type") == "modal_command":
        modal_env, modal_context = build_modal_env_overrides(settings, task.get("payload", {}))
    env = _build_env(settings, task, run_dir, modal_env_overrides=modal_env)
    command, inline_script_path = _build_command(settings, task, run_dir, workdir)
    stdout_path = run_dir / "stdout.log"
    stderr_path = run_dir / "stderr.log"
    stdout_path.write_text("", encoding="utf-8")
    stderr_path.write_text("", encoding="utf-8")
    metadata = {
        "task_id": task_id,
        "type": task["type"],
        "started_at": started_at,
        "run_dir": str(run_dir),
        "workdir": str(workdir),
        "command": command,
        "inline_script_path": str(inline_script_path) if inline_script_path else None,
        "modal_context": modal_context,
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
    stdout_handle = stdout_path.open("w", encoding="utf-8", errors="replace")
    stderr_handle = stderr_path.open("w", encoding="utf-8", errors="replace")
    try:
        process = subprocess.Popen(
            command,
            cwd=str(workdir),
            env=env,
            stdout=stdout_handle,
            stderr=stderr_handle,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
    finally:
        stdout_handle.close()
        stderr_handle.close()
    ACTIVE_PROCESSES[task_id] = process
    state = {
        "task_id": task_id,
        "type": task["type"],
        "pid": process.pid,
        "started_at": started_at,
        "boot_id": boot_id,
        "run_dir": str(run_dir),
        "workdir": str(workdir),
        "command": command,
        "timeout_sec": int(task.get("timeout_sec", 3600)),
        "kill_grace_sec": int(task.get("kill_grace_sec", 15)),
        "modal_context": modal_context,
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
        "stdout_offset": 0,
        "stderr_offset": 0,
        "cancel_requested": False,
    }
    _set_current_task(settings, state)
    return state


def _finalize_background_task(
    settings: AgentSettings,
    state: dict[str, Any],
    *,
    final_status: str,
    exit_code: int | None,
) -> dict[str, Any]:
    finished_at = _now_iso()
    state = _upload_incremental_logs(settings, state, final=True)
    stdout_text = Path(state["stdout_path"]).read_text(encoding="utf-8", errors="replace") if state.get("stdout_path") else ""
    stderr_text = Path(state["stderr_path"]).read_text(encoding="utf-8", errors="replace") if state.get("stderr_path") else ""
    send_task_result(
        settings,
        {
            "task_id": state["task_id"],
            "final_status": final_status,
            "exit_code": exit_code,
            "summary": _build_result_summary(
                {"type": state.get("type"), "modal_context": state.get("modal_context", {})},
                Path(state.get("run_dir") or "."),
                Path(state.get("workdir") or "."),
                list(state.get("command", [])),
                stdout_text,
                stderr_text,
            ),
            "boot_id": state.get("boot_id"),
            "pid": state.get("pid"),
            "pgid_or_job_id": str(state.get("pid")) if state.get("pid") else None,
            "started_at": state.get("started_at"),
            "finished_at": finished_at,
        },
    )
    artifact_summary = {
        "task_id": state["task_id"],
        "type": state.get("type"),
        "final_status": final_status,
        "exit_code": exit_code,
        "started_at": state.get("started_at"),
        "finished_at": finished_at,
        "run_dir": state.get("run_dir"),
        "stdout_bytes": len(stdout_text.encode("utf-8")),
        "stderr_bytes": len(stderr_text.encode("utf-8")),
    }
    send_artifact_file(
        settings,
        task_id=state["task_id"],
        artifact_name="result_summary.json",
        artifact_type="task_summary",
        artifact_bytes=json.dumps(artifact_summary, ensure_ascii=False, indent=2).encode("utf-8"),
        content_type="application/json",
        preview={"final_status": final_status, "exit_code": exit_code},
    )
    ACTIVE_PROCESSES.pop(state["task_id"], None)
    _clear_current_task(settings)
    return {"task_id": state["task_id"], "final_status": final_status, "exit_code": exit_code}


def start_tasks_background(settings: AgentSettings, tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    started: list[dict[str, Any]] = []
    if has_active_task(settings):
        return started
    for task in tasks[:1]:
        started_state = _start_background_task(settings, task)
        started.append({"task_id": started_state["task_id"], "status": "running"})
    return started


def sync_active_task(settings: AgentSettings, task_controls: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    state = _load_current_task(settings)
    if not state.get("task_id"):
        return None
    task_id = state["task_id"]
    process = ACTIVE_PROCESSES.get(task_id)
    if process is None:
        return None

    controls = task_controls or []
    should_cancel = any(item.get("task_id") == task_id and item.get("action") == "cancel" for item in controls)
    if should_cancel and not state.get("cancel_requested"):
        state["cancel_requested"] = True
        save_json(settings.state_dir / "current_task.json", state)
        _terminate_process_tree(process, int(state.get("kill_grace_sec", 15)))

    state = _upload_incremental_logs(settings, state, final=False)
    timeout_sec = int(state.get("timeout_sec", 3600))
    started_raw = state.get("started_at")
    started_at = datetime.fromisoformat(str(started_raw).replace("Z", "+00:00")) if started_raw else datetime.now(UTC)
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=UTC)
    if process.poll() is None and (datetime.now(UTC) - started_at).total_seconds() > timeout_sec:
        _terminate_process_tree(process, int(state.get("kill_grace_sec", 15)))
        state["timed_out"] = True
        save_json(settings.state_dir / "current_task.json", state)

    return_code = process.poll()
    if return_code is None:
        return {"task_id": task_id, "status": "running"}

    if state.get("cancel_requested"):
        return _finalize_background_task(settings, state, final_status="cancelled", exit_code=return_code)
    if state.get("timed_out"):
        return _finalize_background_task(settings, state, final_status="timeout", exit_code=return_code)
    if return_code == 0:
        return _finalize_background_task(settings, state, final_status="succeeded", exit_code=0)
    return _finalize_background_task(settings, state, final_status="failed", exit_code=return_code)


def recover_orphaned_task(settings: AgentSettings) -> dict[str, Any] | None:
    state = _load_current_task(settings)
    task_id = state.get("task_id")
    if not task_id:
        return None
    if task_id in ACTIVE_PROCESSES:
        return None

    pid = state.get("pid")
    process_alive = _pid_exists(int(pid) if pid else None)
    state = _upload_incremental_logs(settings, state, final=True)

    if process_alive:
        final_status = "lost"
        exit_code = None
        state["recovery_note"] = "agent restarted while task process was still alive; reattach not supported in MVP"
    elif state.get("cancel_requested"):
        final_status = "cancelled"
        exit_code = None
        state["recovery_note"] = "agent recovered a previously cancelled task without live process handle"
    elif state.get("timed_out"):
        final_status = "timeout"
        exit_code = None
        state["recovery_note"] = "agent recovered a timed-out task without live process handle"
    else:
        final_status = "failed"
        exit_code = None
        state["recovery_note"] = "agent recovered an orphaned task after restart; exit code unavailable"
    save_json(settings.state_dir / "current_task.json", state)
    return _finalize_background_task(settings, state, final_status=final_status, exit_code=exit_code)


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
        native_result = _execute_native_task(settings, task, run_dir)
        if native_result is not None:
            finished_at = _now_iso()
            send_task_result(
                settings,
                {
                    "task_id": task_id,
                    "final_status": "succeeded",
                    "exit_code": 0,
                    "summary": {"run_dir": str(run_dir), "native_result": native_result},
                    "boot_id": boot_id,
                    "started_at": started_at,
                    "finished_at": finished_at,
                },
            )
            send_artifact_file(
                settings,
                task_id=task_id,
                artifact_name="result_summary.json",
                artifact_type="task_summary",
                artifact_bytes=json.dumps(
                    {
                        "task_id": task_id,
                        "type": task["type"],
                        "final_status": "succeeded",
                        "exit_code": 0,
                        "started_at": started_at,
                        "finished_at": finished_at,
                        "run_dir": str(run_dir),
                        "native_result": native_result,
                    },
                    ensure_ascii=False,
                    indent=2,
                ).encode("utf-8"),
                content_type="application/json",
                preview={"final_status": "succeeded", "exit_code": 0},
            )
            return {"task_id": task_id, "final_status": "succeeded", "exit_code": 0}

        workdir = _resolve_workdir(settings, task, run_dir)
        workdir.mkdir(parents=True, exist_ok=True)
        modal_context = {}
        modal_env: dict[str, str] = {}
        if task.get("type") == "modal_command":
            modal_env, modal_context = build_modal_env_overrides(settings, task.get("payload", {}))
        env = _build_env(settings, task, run_dir, modal_env_overrides=modal_env)

        command, inline_script_path = _build_command(settings, task, run_dir, workdir)
        metadata = {
            "task_id": task_id,
            "type": task["type"],
            "started_at": started_at,
            "run_dir": str(run_dir),
            "workdir": str(workdir),
            "command": command,
            "inline_script_path": str(inline_script_path) if inline_script_path else None,
            "modal_context": modal_context,
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

    result_summary = _build_result_summary(
        {**task, "modal_context": metadata.get("modal_context", {}) if "metadata" in locals() else {}},
        run_dir,
        workdir,
        command,
        stdout_text,
        stderr_text,
    )
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

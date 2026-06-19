from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from typing import Any

from gpufleet_node_agent.api_client import (
    send_artifact_file as _default_send_artifact_file,
    send_task_event as _default_send_task_event,
    send_task_result as _default_send_task_result,
)
from gpufleet_node_agent.collect import get_boot_id
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.execution import prepare_python_command, prepare_shell_command
from gpufleet_node_agent.modal_support import build_modal_env_overrides
from gpufleet_node_agent.runner.artifact import (
    build_result_summary,
    execute_native_task,
    now_iso,
    prepare_run_dir,
    resolve_safe_path,
    resolve_workdir,
    task_extra_roots,
    write_local_logs,
)
from gpufleet_node_agent.runner.log_pump import upload_log_text
from gpufleet_node_agent.state import save_json

ACTIVE_PROCESSES: dict[str, subprocess.Popen[str]] = {}


def _compat_attr(name: str, default: Any) -> Any:
    module = sys.modules.get("gpufleet_node_agent.task_runner")
    return getattr(module, name, default) if module is not None else default


def build_env(settings: AgentSettings, task: dict[str, Any], run_dir: str | os.PathLike[str], *, modal_env_overrides: dict[str, str] | None = None) -> dict[str, str]:
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


def build_modal_command(settings: AgentSettings, task: dict[str, Any], workdir: str | os.PathLike[str]) -> list[str]:
    payload = task.get("payload", {})
    extra_roots = task_extra_roots(task)
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
    for flag, enabled in (("--detach", payload.get("detach")), ("--interactive", payload.get("interactive")), ("--quiet", payload.get("quiet")), ("--timestamps", payload.get("timestamps"))):
        if enabled:
            command.append(flag)
    modal_env = str(payload.get("modal_env", "")).strip()
    if modal_env:
        command.extend(["--env", modal_env])
    write_result_path = payload.get("write_result_path")
    if write_result_path:
        raw_result_path = resolve_safe_path(settings, str((workdir / write_result_path) if not os.path.isabs(str(write_result_path)) else write_result_path), extra_roots=extra_roots)
        raw_result_path.parent.mkdir(parents=True, exist_ok=True)
        command.extend(["--write-result", str(raw_result_path)])
    if module_path:
        command.append("-m")
        target_ref = str(module_path).strip()
        if not target_ref:
            raise ValueError("modal_command payload.module_path must not be empty")
    elif script_path:
        raw_script_path = workdir / script_path if not os.path.isabs(str(script_path)) else script_path
        target_ref = str(resolve_safe_path(settings, str(raw_script_path), allow_missing=False, extra_roots=extra_roots))
    else:
        raise ValueError("modal_command requires payload.command or payload.script_path/module_path")
    command.append(f"{target_ref}::{entrypoint}" if entrypoint else target_ref)
    command.extend(str(item) for item in (args or []))
    return command


def build_command(settings: AgentSettings, task: dict[str, Any], run_dir: str | os.PathLike[str], workdir: str | os.PathLike[str]) -> tuple[list[str], str | None, dict[str, str], dict[str, Any]]:
    task_type = task["type"]
    payload = task.get("payload", {})
    if task_type == "health_check":
        command = [settings.python_executable or sys.executable, "-c", "import json,os,platform,sys;print(json.dumps({'ok': True,'python': sys.version.split()[0],'executable': sys.executable,'cwd': os.getcwd(),'platform': platform.platform()}, ensure_ascii=False))"]
        return command, None, {}, {"backend": "default"}
    if task_type == "shell":
        command_text = str(payload.get("command", "")).strip()
        if not command_text:
            raise ValueError("shell task missing payload.command")
        prepared = prepare_shell_command(settings, payload, command_text, workdir=workdir)
        return prepared.command, None, prepared.env_overrides, prepared.summary
    if task_type == "python_script":
        script_text = str(payload.get("script", "")).strip()
        if not script_text:
            raise ValueError("python_script task missing payload.script")
        script_path = os.fspath(os.path.join(run_dir, "inline_task.py"))
        with open(script_path, "w", encoding="utf-8") as handle:
            handle.write(script_text + "\n")
        prepared = prepare_python_command(settings, payload, [script_path], workdir=workdir)
        return prepared.command, script_path, prepared.env_overrides, prepared.summary
    if task_type == "pip_install":
        packages = payload.get("packages")
        if not isinstance(packages, list) or not packages:
            raise ValueError("pip_install task requires non-empty payload.packages")
        extra_args = payload.get("extra_args", [])
        if extra_args is not None and not isinstance(extra_args, list):
            raise ValueError("pip_install payload.extra_args must be a list")
        package_values = [str(item) for item in packages]
        normalized_extra_args = [str(item) for item in (extra_args or [])]
        if any(os.path.exists(item) for item in package_values) and "--no-build-isolation" not in normalized_extra_args:
            normalized_extra_args.append("--no-build-isolation")
        prepared = prepare_python_command(settings, payload, ["-m", "pip", "install", *package_values, *normalized_extra_args], workdir=workdir)
        return prepared.command, None, prepared.env_overrides, prepared.summary
    if task_type == "git_pull":
        repo_url = str(payload.get("repo_url", "")).strip()
        repo_dir = payload.get("repo_dir")
        if not repo_url or not repo_dir:
            raise ValueError("git_pull task requires payload.repo_url and payload.repo_dir")
        repo_path = resolve_safe_path(settings, str(repo_dir), extra_roots=task_extra_roots(task))
        branch = str(payload.get("branch", "")).strip()
        if not repo_path.exists() or not (repo_path / ".git").exists():
            return (["git", "clone", "--branch", branch, repo_url, str(repo_path)] if branch else ["git", "clone", repo_url, str(repo_path)]), None, {}, {"backend": "native"}
        return (["git", "-C", str(repo_path), "pull", "origin", branch] if branch else ["git", "-C", str(repo_path), "pull"]), None, {}, {"backend": "native"}
    if task_type == "modal_command":
        return build_modal_command(settings, task, workdir), None, {}, {"backend": "modal"}
    raise ValueError(f"Unsupported task type for node agent MVP: {task_type}")


def terminate_process_tree(process: subprocess.Popen[str], grace_sec: int) -> None:
    if os.name == "nt":
        process.terminate()
        try:
            process.wait(timeout=max(grace_sec, 1))
        except subprocess.TimeoutExpired:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, text=True, check=False)
            process.wait(timeout=10)
        return
    process.terminate()
    try:
        process.wait(timeout=max(grace_sec, 1))
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def pid_exists(pid: int | None) -> bool:
    if not pid:
        return False
    if os.name == "nt":
        result = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
        return str(pid) in result.stdout
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def execute_task(settings: AgentSettings, task: dict[str, Any]) -> dict[str, Any]:
    send_task_event = _compat_attr("send_task_event", _default_send_task_event)
    send_task_result = _compat_attr("send_task_result", _default_send_task_result)
    send_artifact_file = _compat_attr("send_artifact_file", _default_send_artifact_file)
    task_id = task["task_id"]
    boot_id = get_boot_id(settings)
    started_at = now_iso()
    run_dir = prepare_run_dir(settings, task_id)
    stdout_text = ""
    stderr_text = ""
    final_status = "failed"
    exit_code: int | None = None
    finished_at = now_iso()
    process: subprocess.Popen[str] | None = None
    command: list[str] = []
    workdir = run_dir
    execution_summary: dict[str, Any] = {"backend": "default"}
    metadata: dict[str, Any] = {}
    try:
        native_result = execute_native_task(settings, task, run_dir)
        if native_result is not None:
            finished_at = now_iso()
            send_task_result(settings, {"task_id": task_id, "final_status": "succeeded", "exit_code": 0, "summary": {"run_dir": str(run_dir), "native_result": native_result}, "boot_id": boot_id, "started_at": started_at, "finished_at": finished_at})
            send_artifact_file(settings, task_id=task_id, artifact_name="result_summary.json", artifact_type="task_summary", artifact_bytes=json.dumps({"task_id": task_id, "type": task["type"], "final_status": "succeeded", "exit_code": 0, "started_at": started_at, "finished_at": finished_at, "run_dir": str(run_dir), "native_result": native_result}, ensure_ascii=False, indent=2).encode("utf-8"), content_type="application/json", preview={"final_status": "succeeded", "exit_code": 0})
            return {"task_id": task_id, "final_status": "succeeded", "exit_code": 0}
        workdir = resolve_workdir(settings, task, run_dir)
        workdir.mkdir(parents=True, exist_ok=True)
        modal_context = {}
        modal_env, modal_context = build_modal_env_overrides(settings, task.get("payload", {})) if task.get("type") == "modal_command" else ({}, {})
        env = build_env(settings, task, run_dir, modal_env_overrides=modal_env)
        command, inline_script_path, execution_env_overrides, execution_summary = build_command(settings, task, run_dir, workdir)
        env.update(execution_env_overrides)
        metadata = {"task_id": task_id, "type": task["type"], "started_at": started_at, "run_dir": str(run_dir), "workdir": str(workdir), "command": command, "inline_script_path": inline_script_path, "execution": execution_summary, "modal_context": modal_context}
        save_json(run_dir / "task_metadata.json", metadata)
        send_task_event(settings, {"task_id": task_id, "event": "running", "boot_id": boot_id, "detail": {"run_dir": str(run_dir), "workdir": str(workdir)}})
        process = subprocess.Popen(command, cwd=str(workdir), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        save_json(settings.state_dir / "current_task.json", {"task_id": task_id, "pid": process.pid, "started_at": started_at, "run_dir": str(run_dir)})
        stdout_text, stderr_text = process.communicate(timeout=task.get("timeout_sec", 3600))
        exit_code = process.returncode
        finished_at = now_iso()
        final_status = "succeeded" if exit_code == 0 else "failed"
    except subprocess.TimeoutExpired:
        if process is not None:
            terminate_process_tree(process, int(task.get("kill_grace_sec", 15)))
            stdout_text, stderr_text = process.communicate()
        finished_at = now_iso()
        final_status = "timeout"
        exit_code = None
    except Exception as exc:
        finished_at = now_iso()
        final_status = "failed"
        stderr_text = f"{type(exc).__name__}: {exc}\n"
    finally:
        write_local_logs(run_dir, stdout_text, stderr_text)
        upload_log_text(settings, task_id, "stdout", stdout_text)
        upload_log_text(settings, task_id, "stderr", stderr_text)
        save_json(settings.state_dir / "current_task.json", {})
    result_summary = build_result_summary({**task, "modal_context": metadata.get("modal_context", {})}, run_dir, workdir, command, stdout_text, stderr_text)
    result_summary["execution"] = execution_summary
    send_task_result(settings, {"task_id": task_id, "final_status": final_status, "exit_code": exit_code, "summary": result_summary, "boot_id": boot_id, "pid": process.pid if process is not None else None, "pgid_or_job_id": str(process.pid) if process is not None else None, "started_at": started_at, "finished_at": finished_at})
    send_artifact_file(settings, task_id=task_id, artifact_name="result_summary.json", artifact_type="task_summary", artifact_bytes=json.dumps({"task_id": task_id, "type": task["type"], "final_status": final_status, "exit_code": exit_code, "started_at": started_at, "finished_at": finished_at, "run_dir": str(run_dir), "stdout_bytes": len(stdout_text.encode("utf-8")), "stderr_bytes": len(stderr_text.encode("utf-8"))}, ensure_ascii=False, indent=2).encode("utf-8"), content_type="application/json", preview={"final_status": final_status, "exit_code": exit_code})
    return {"task_id": task_id, "final_status": final_status, "exit_code": exit_code}


def execute_tasks(settings: AgentSettings, tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [execute_task(settings, task) for task in tasks]

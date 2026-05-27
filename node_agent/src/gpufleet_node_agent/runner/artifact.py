from __future__ import annotations

import json
import re
import shutil
import sys
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from gpufleet_node_agent.api_client import send_artifact_file as _default_send_artifact_file
from gpufleet_node_agent.collect import (
    collect_cpu,
    collect_disks,
    collect_gpus,
    collect_memory,
    collect_nvidia,
    collect_primary_network,
    collect_python_env,
)
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.modal_support import collect_modal_runtime_status


def _compat_attr(name: str, default: Any) -> Any:
    module = sys.modules.get("gpufleet_node_agent.task_runner")
    return getattr(module, name, default) if module is not None else default


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def safe_task_name(task_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in task_id)


def payload_value(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload:
            return payload[key]
    return None


def prepare_run_dir(settings: AgentSettings, task_id: str) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = settings.runs_dir / f"{timestamp}_{safe_task_name(task_id)}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def resolve_workdir(settings: AgentSettings, task: dict[str, Any], run_dir: Path) -> Path:
    workdir = task.get("workdir")
    return Path(workdir) if workdir else run_dir


def task_extra_roots(task: dict[str, Any]) -> list[str]:
    return [str(task.get("workdir"))] if task.get("workdir") else []


def allowed_roots(settings: AgentSettings, extra_roots: list[str] | None = None) -> list[Path]:
    roots = [settings.agent_root.resolve()]
    for path in (settings.repos_dir, settings.runs_dir, settings.artifacts_dir, settings.logs_dir, settings.state_dir):
        roots.append(path.resolve())
    for extra in extra_roots or []:
        roots.append(Path(extra).resolve(strict=False))
    return roots


def is_within(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False


def resolve_safe_path(
    settings: AgentSettings,
    raw_path: str,
    *,
    allow_missing: bool = True,
    extra_roots: list[str] | None = None,
) -> Path:
    candidate = Path(raw_path)
    resolved = candidate.resolve(strict=False) if allow_missing else candidate.resolve()
    if not any(is_within(resolved, root) for root in allowed_roots(settings, extra_roots)):
        raise ValueError(f"path outside allowed roots: {raw_path}")
    return resolved


def execute_native_task(settings: AgentSettings, task: dict[str, Any], run_dir: Path) -> dict[str, Any] | None:
    task_type = task["type"]
    payload = task.get("payload", {})
    extra_roots = task_extra_roots(task)
    send_artifact_file = _compat_attr("send_artifact_file", _default_send_artifact_file)

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
            "network": collect_primary_network(settings, track_rate=False),
            "modal_runtime": collect_modal_runtime_status(settings),
        }
    if task_type == "file_mkdir":
        target_raw = payload_value(payload, "path", "target_path")
        if not target_raw:
            raise ValueError("file_mkdir task requires payload.path")
        target = resolve_safe_path(settings, str(target_raw), extra_roots=extra_roots)
        target.mkdir(parents=True, exist_ok=True)
        return {"path": str(target), "created": True}
    if task_type == "file_write":
        target_raw = payload_value(payload, "path", "target_path")
        if not target_raw:
            raise ValueError("file_write task requires payload.path")
        target = resolve_safe_path(settings, str(target_raw), extra_roots=extra_roots)
        target.parent.mkdir(parents=True, exist_ok=True)
        content = str(payload.get("content", ""))
        target.write_text(content, encoding=str(payload.get("encoding", "utf-8")))
        return {"path": str(target), "bytes": len(content.encode("utf-8"))}
    if task_type == "file_patch_text":
        target_raw = payload_value(payload, "path", "target_path")
        if not target_raw:
            raise ValueError("file_patch_text task requires payload.path")
        target = resolve_safe_path(settings, str(target_raw), allow_missing=False, extra_roots=extra_roots)
        source = target.read_text(encoding=str(payload.get("encoding", "utf-8")))
        old_text = str(payload_value(payload, "old_text", "anchor") or "")
        new_text = str(payload_value(payload, "new_text", "replacement") or "")
        if old_text not in source:
            raise ValueError("old_text not found in file")
        updated = source.replace(old_text, new_text, 1 if not payload.get("replace_all") else -1)
        target.write_text(updated, encoding=str(payload.get("encoding", "utf-8")))
        return {"path": str(target), "replaced": True}
    if task_type == "file_move":
        source_raw = payload_value(payload, "source", "source_path")
        target_raw = payload_value(payload, "target", "target_path")
        if not source_raw or not target_raw:
            raise ValueError("file_move task requires payload.source and payload.target")
        source = resolve_safe_path(settings, str(source_raw), allow_missing=False, extra_roots=extra_roots)
        target = resolve_safe_path(settings, str(target_raw), extra_roots=extra_roots)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))
        return {"source": str(source), "target": str(target)}
    if task_type == "file_delete":
        target_raw = payload_value(payload, "path", "target_path")
        if not target_raw:
            raise ValueError("file_delete task requires payload.path")
        target = resolve_safe_path(settings, str(target_raw), allow_missing=False, extra_roots=extra_roots)
        if target.is_dir():
            shutil.rmtree(target)
            kind = "directory"
        else:
            target.unlink()
            kind = "file"
        return {"path": str(target), "deleted": kind}
    if task_type == "file_extract":
        archive = resolve_safe_path(settings, str(payload["archive_path"]), allow_missing=False, extra_roots=extra_roots)
        target_dir_raw = payload_value(payload, "target_dir", "target_path")
        if not target_dir_raw:
            raise ValueError("file_extract task requires payload.target_dir")
        target_dir = resolve_safe_path(settings, str(target_dir_raw), extra_roots=extra_roots)
        target_dir.mkdir(parents=True, exist_ok=True)
        if archive.suffix.lower() != ".zip":
            raise ValueError("only .zip archives are supported in MVP")
        with zipfile.ZipFile(archive, "r") as zf:
            zf.extractall(target_dir)
        return {"archive_path": str(archive), "target_dir": str(target_dir)}
    if task_type == "file_preview":
        target_raw = payload_value(payload, "path", "target_path")
        if not target_raw:
            raise ValueError("file_preview task requires payload.path")
        target = resolve_safe_path(settings, str(target_raw), allow_missing=False, extra_roots=extra_roots)
        if target.is_dir():
            entries = [
                {"name": item.name, "is_dir": item.is_dir(), "size_bytes": item.stat().st_size if item.is_file() else None}
                for item in sorted(target.iterdir(), key=lambda path: path.name.lower())[: int(payload.get("limit", 50))]
            ]
            preview_bytes = json.dumps({"path": str(target), "entries": entries}, ensure_ascii=False, indent=2).encode("utf-8")
            send_artifact_file(settings, task_id=task["task_id"], artifact_name="file_preview.json", artifact_type="file_preview", artifact_bytes=preview_bytes, content_type="application/json", preview={"path": str(target), "entry_count": len(entries)})
            return {"path": str(target), "entry_count": len(entries)}
        text = target.read_text(encoding=str(payload.get("encoding", "utf-8")), errors="replace")
        preview_text = text[: int(payload_value(payload, "max_chars", "max_bytes") or 4000)]
        send_artifact_file(settings, task_id=task["task_id"], artifact_name=f"{target.name}.preview.txt", artifact_type="file_preview", artifact_bytes=preview_text.encode("utf-8"), content_type="text/plain", preview={"path": str(target), "chars": len(preview_text)})
        return {"path": str(target), "chars": len(preview_text)}
    if task_type == "upload_and_unpack":
        archive = resolve_safe_path(settings, str(payload["archive_path"]), allow_missing=False, extra_roots=extra_roots)
        target_dir = resolve_safe_path(settings, str(payload["target_dir"]), extra_roots=extra_roots)
        target_dir.mkdir(parents=True, exist_ok=True)
        if archive.suffix.lower() != ".zip":
            raise ValueError("only .zip archives are supported in MVP")
        with zipfile.ZipFile(archive, "r") as zf:
            zf.extractall(target_dir)
        return {"archive_path": str(archive), "target_dir": str(target_dir), "unpacked": True}
    if task_type == "download_file":
        url = str(payload.get("url", "")).strip()
        target_path_raw = payload.get("target_path")
        if not url or not target_path_raw:
            raise ValueError("download_file task requires payload.url and payload.target_path")
        target_path = resolve_safe_path(settings, str(target_path_raw), extra_roots=extra_roots)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=int(payload.get("timeout_sec", 60))) as response:
            content = response.read()
            content_type = response.headers.get("Content-Type")
        target_path.write_bytes(content)
        preview = {"url": url, "target_path": str(target_path), "size_bytes": len(content), "content_type": content_type}
        send_artifact_file(settings, task_id=task["task_id"], artifact_name=f"{target_path.name}.download.json", artifact_type="download_summary", artifact_bytes=json.dumps(preview, ensure_ascii=False, indent=2).encode("utf-8"), content_type="application/json", preview=preview)
        return preview
    return None


def write_local_logs(run_dir: Path, stdout_text: str, stderr_text: str) -> None:
    (run_dir / "stdout.log").write_text(stdout_text, encoding="utf-8")
    (run_dir / "stderr.log").write_text(stderr_text, encoding="utf-8")


def build_result_summary(task: dict[str, Any], run_dir: Path, workdir: Path, command: list[str], stdout_text: str, stderr_text: str) -> dict[str, Any]:
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

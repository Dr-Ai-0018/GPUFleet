from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.state import load_json, save_json


def _run_command(args: list[str]) -> str | None:
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError:
        return None

    if result.returncode != 0:
        return None
    return result.stdout.strip()


def _run_powershell(script: str) -> str | None:
    candidates = [
        shutil.which("pwsh"),
        shutil.which("powershell"),
    ]
    for exe in candidates:
        if not exe:
            continue
        output = _run_command([exe, "-NoProfile", "-Command", script])
        if output is not None:
            return output
    return None


def get_boot_id(settings: AgentSettings) -> str:
    state_path = settings.state_dir / "agent_state.json"
    state = load_json(state_path, {"boot_id": str(uuid.uuid4())})
    if "boot_id" not in state or not state["boot_id"]:
        state["boot_id"] = str(uuid.uuid4())
    save_json(state_path, state)
    return str(state["boot_id"])


def collect_cpu() -> dict[str, Any]:
    usage_percent: float | None = None
    model = platform.processor() or None

    if os.name == "nt":
        cpu_json = _run_powershell(
            "[pscustomobject]@{Name=(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name); "
            "Load=(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty LoadPercentage)} | ConvertTo-Json -Compress"
        )
        if cpu_json:
            try:
                parsed = json.loads(cpu_json)
                model = parsed.get("Name") or model
                usage_percent = float(parsed["Load"]) if parsed.get("Load") is not None else None
            except Exception:
                pass
    else:
        loadavg = os.getloadavg()[0] if hasattr(os, "getloadavg") else None
        cores = os.cpu_count() or 1
        if loadavg is not None:
            usage_percent = round(min(loadavg / cores, 1.0) * 100, 2)

    return {
        "model": model,
        "logical_cores": os.cpu_count(),
        "usage_percent": usage_percent,
    }


def collect_memory() -> dict[str, Any]:
    if os.name == "nt":
        output = _run_powershell(
            "[pscustomobject]@{Total=(Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize; "
            "Free=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory} | ConvertTo-Json -Compress"
        )
        if output:
            try:
                parsed = json.loads(output)
                total_bytes = int(parsed["Total"]) * 1024
                free_bytes = int(parsed["Free"]) * 1024
                used_bytes = max(total_bytes - free_bytes, 0)
                usage_percent = round((used_bytes / total_bytes) * 100, 2) if total_bytes else None
                return {
                    "total_bytes": total_bytes,
                    "used_bytes": used_bytes,
                    "usage_percent": usage_percent,
                }
            except Exception:
                pass

    if Path("/proc/meminfo").exists():
        data: dict[str, int] = {}
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, value = line.split(":", 1)
            data[key] = int(value.strip().split()[0]) * 1024
        total_bytes = data.get("MemTotal")
        available_bytes = data.get("MemAvailable")
        if total_bytes is not None and available_bytes is not None:
            used_bytes = max(total_bytes - available_bytes, 0)
            usage_percent = round((used_bytes / total_bytes) * 100, 2) if total_bytes else None
            return {
                "total_bytes": total_bytes,
                "used_bytes": used_bytes,
                "usage_percent": usage_percent,
            }

    return {
        "total_bytes": None,
        "used_bytes": None,
        "usage_percent": None,
    }


def collect_disks(settings: AgentSettings) -> list[dict[str, Any]]:
    candidates = [settings.agent_root]
    seen: set[str] = set()
    disks: list[dict[str, Any]] = []
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            root = resolved.anchor or str(resolved)
            if root in seen:
                continue
            seen.add(root)
            usage = shutil.disk_usage(resolved)
            used_bytes = usage.total - usage.free
            usage_percent = round((used_bytes / usage.total) * 100, 2) if usage.total else None
            disks.append(
                {
                    "mount": root,
                    "total_bytes": usage.total,
                    "free_bytes": usage.free,
                    "usage_percent": usage_percent,
                }
            )
        except Exception:
            continue
    return disks


def collect_gpus() -> list[dict[str, Any]]:
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return []

    query = ",".join(
        [
            "index",
            "name",
            "memory.total",
            "memory.used",
            "utilization.gpu",
            "temperature.gpu",
        ]
    )
    output = _run_command(
        [
            nvidia_smi,
            f"--query-gpu={query}",
            "--format=csv,noheader,nounits",
        ]
    )
    if not output:
        return []

    gpus: list[dict[str, Any]] = []
    for raw_line in output.splitlines():
        parts = [part.strip() for part in raw_line.split(",")]
        if len(parts) != 6:
            continue
        try:
            gpus.append(
                {
                    "index": int(parts[0]),
                    "model": parts[1] or None,
                    "total_vram_mb": int(parts[2]) if parts[2] else None,
                    "used_vram_mb": int(parts[3]) if parts[3] else None,
                    "utilization_percent": float(parts[4]) if parts[4] else None,
                    "temperature_c": float(parts[5]) if parts[5] else None,
                }
            )
        except ValueError:
            continue
    return gpus


def collect_python_env(settings: AgentSettings) -> dict[str, Any]:
    pip_available = False
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "--version"],
            capture_output=True,
            text=True,
            check=False,
        )
        pip_available = result.returncode == 0
    except OSError:
        pip_available = False

    return {
        "python_executable": settings.python_executable or sys.executable,
        "venv_path": settings.venv_path,
        "pip_available": pip_available,
        "python_version": platform.python_version(),
    }


def collect_task_runtime(settings: AgentSettings) -> dict[str, Any]:
    state_path = settings.state_dir / "current_task.json"
    state = load_json(state_path, {})
    return {
        "active_task_id": state.get("task_id"),
        "active_pid": state.get("pid"),
        "started_at": state.get("started_at"),
    }

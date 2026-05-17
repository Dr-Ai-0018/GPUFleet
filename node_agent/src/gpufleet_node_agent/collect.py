from __future__ import annotations

import json
import ctypes
import os
import platform
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.execution import detect_python_env, resolve_default_python
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
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            ) as key:
                registry_model, _ = winreg.QueryValueEx(key, "ProcessorNameString")
                model = registry_model or model
        except Exception:
            pass

        model = (
            os.environ.get("PROCESSOR_IDENTIFIER")
            or os.environ.get("PROCESSOR_ARCHITECTURE")
            or model
        )
        counter_output = _run_powershell(
            "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples | "
            "Select-Object -First 1 -ExpandProperty CookedValue"
        )
        if counter_output:
            try:
                usage_percent = round(float(counter_output.strip()), 2)
            except ValueError:
                usage_percent = None

        typeperf_output = _run_command(
            [
                "typeperf",
                r"\Processor(_Total)\% Processor Time",
                "-sc",
                "1",
            ]
        )
        if usage_percent is None and typeperf_output:
            lines = [line.strip() for line in typeperf_output.splitlines() if line.strip()]
            if len(lines) >= 2:
                try:
                    last_value = lines[-1].split(",")[-1].strip().strip('"')
                    usage_percent = round(float(last_value), 2)
                except ValueError:
                    usage_percent = None
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
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        memory_status = MEMORYSTATUSEX()
        memory_status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory_status)):
            total_bytes = int(memory_status.ullTotalPhys)
            free_bytes = int(memory_status.ullAvailPhys)
            used_bytes = max(total_bytes - free_bytes, 0)
            usage_percent = round((used_bytes / total_bytes) * 100, 2) if total_bytes else None
            return {
                "total_bytes": total_bytes,
                "used_bytes": used_bytes,
                "usage_percent": usage_percent,
            }

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
    disks: list[dict[str, Any]] = []
    seen: set[str] = set()

    if os.name == "nt":
        candidates = [Path(f"{letter}:\\") for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    else:
        candidates = [settings.agent_root]

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            root = resolved.anchor or str(resolved)
            if root in seen or not resolved.exists():
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
            "power.draw",
            "power.limit",
            "clocks.current.graphics",
            "clocks.max.graphics",
            "fan.speed",
            "pcie.link.gen.current",
            "pcie.link.width.current",
            "encoder.stats.sessionCount",
            "decoder.stats.sessionCount",
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
        if len(parts) < 6:
            continue

        def _float(idx: int) -> float | None:
            try:
                v = parts[idx] if idx < len(parts) else ""
                if not v or v == "[N/A]" or v == "N/A":
                    return None
                return float(v)
            except (ValueError, IndexError):
                return None

        def _int(idx: int) -> int | None:
            try:
                v = parts[idx] if idx < len(parts) else ""
                if not v or v == "[N/A]" or v == "N/A":
                    return None
                return int(float(v))
            except (ValueError, IndexError):
                return None

        gpus.append(
            {
                "index": _int(0) or 0,
                "model": parts[1] if len(parts) > 1 and parts[1] else None,
                "total_vram_mb": _int(2),
                "used_vram_mb": _int(3),
                "utilization_percent": _float(4),
                "temperature_c": _float(5),
                "power_draw_w": _float(6),
                "power_limit_w": _float(7),
                "clock_graphics_mhz": _int(8),
                "clock_max_graphics_mhz": _int(9),
                "fan_speed_percent": _int(10),
                "pcie_gen": _int(11),
                "pcie_width": _int(12),
                "encoder_sessions": _int(13),
                "decoder_sessions": _int(14),
            }
        )
    return gpus


def collect_nvidia() -> dict[str, Any]:
    nvidia_smi = shutil.which("nvidia-smi")
    nvcc = shutil.which("nvcc")
    driver_version: str | None = None
    cuda_version: str | None = None
    nvcc_version: str | None = None

    if nvidia_smi:
        driver_output = _run_command(
            [
                nvidia_smi,
                "--query-gpu=driver_version",
                "--format=csv,noheader",
            ]
        )
        if driver_output:
            first_line = next((line.strip() for line in driver_output.splitlines() if line.strip()), None)
            if first_line:
                driver_version = first_line

        banner_output = _run_command([nvidia_smi])
        if banner_output:
            driver_match = re.search(r"Driver Version:\s*([0-9.]+)", banner_output)
            cuda_match = re.search(r"CUDA Version:\s*([0-9.]+)", banner_output)
            if driver_match and not driver_version:
                driver_version = driver_match.group(1)
            if cuda_match:
                cuda_version = cuda_match.group(1)

    if nvcc:
        nvcc_output = _run_command([nvcc, "--version"])
        if nvcc_output:
            release_match = re.search(r"release\s+([0-9.]+)", nvcc_output)
            if release_match:
                nvcc_version = release_match.group(1)
            if not cuda_version and nvcc_version:
                cuda_version = nvcc_version

    return {
        "driver_version": driver_version,
        "cuda_version": cuda_version,
        "nvcc_version": nvcc_version,
        "nvidia_smi_path": nvidia_smi,
    }


def collect_python_env(settings: AgentSettings) -> dict[str, Any]:
    python_env = detect_python_env(settings)
    pip_available = False
    try:
        python_executable = resolve_default_python(settings)
        result = subprocess.run(
            [python_executable, "-m", "pip", "--version"],
            capture_output=True,
            text=True,
            check=False,
        )
        pip_available = result.returncode == 0
    except (OSError, ValueError):
        pip_available = False

    python_env["pip_available"] = pip_available
    python_env["python_version"] = platform.python_version()
    return python_env


def collect_task_runtime(settings: AgentSettings) -> dict[str, Any]:
    state_path = settings.state_dir / "current_task.json"
    state = load_json(state_path, {})
    return {
        "active_task_id": state.get("task_id"),
        "active_pid": state.get("pid"),
        "started_at": state.get("started_at"),
    }

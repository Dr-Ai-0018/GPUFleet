from __future__ import annotations

import json
import ctypes
import os
import platform
import re
import shutil
import subprocess
import time
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
    per_core_percent: list[float] = []
    physical_cores: int | None = None
    current_clock_mhz: int | None = None
    max_clock_mhz: int | None = None

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

        if not model:
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

        per_core_output = _run_powershell(
            "$samples = (Get-Counter '\\Processor(*)\\% Processor Time').CounterSamples | "
            "Where-Object { $_.InstanceName -match '^[0-9]+$' } | "
            "Sort-Object { [int]$_.InstanceName } | "
            "ForEach-Object { [math]::Round($_.CookedValue, 2) }; "
            "$samples -join ','"
        )
        if per_core_output:
            try:
                per_core_percent = [
                    round(float(item.strip()), 2)
                    for item in per_core_output.split(",")
                    if item.strip()
                ]
            except ValueError:
                per_core_percent = []

        processor_info_output = _run_powershell(
            "$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 NumberOfCores,CurrentClockSpeed,MaxClockSpeed; "
            "if ($cpu) { $cpu | ConvertTo-Json -Compress }"
        )
        if processor_info_output:
            try:
                processor_info = json.loads(processor_info_output)
                if isinstance(processor_info, dict):
                    number_of_cores = processor_info.get("NumberOfCores")
                    current_clock = processor_info.get("CurrentClockSpeed")
                    max_clock = processor_info.get("MaxClockSpeed")
                    if number_of_cores is not None:
                        physical_cores = int(number_of_cores)
                    if current_clock is not None:
                        current_clock_mhz = int(current_clock)
                    if max_clock is not None:
                        max_clock_mhz = int(max_clock)
            except (ValueError, TypeError):
                physical_cores = None
                current_clock_mhz = None
                max_clock_mhz = None
    else:
        loadavg = os.getloadavg()[0] if hasattr(os, "getloadavg") else None
        cores = os.cpu_count() or 1
        if loadavg is not None:
            usage_percent = round(min(loadavg / cores, 1.0) * 100, 2)

    return {
        "model": model,
        "logical_cores": os.cpu_count(),
        "physical_cores": physical_cores,
        "usage_percent": usage_percent,
        "current_clock_mhz": current_clock_mhz,
        "max_clock_mhz": max_clock_mhz,
        "per_core_percent": per_core_percent,
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
            memory_detail_output = _run_powershell(
                "$modules = @(Get-CimInstance Win32_PhysicalMemory); "
                "$array = Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1; "
                "$counters = Get-Counter '\\Memory\\Cache Bytes','\\Memory\\Committed Bytes','\\Memory\\Commit Limit','\\Memory\\Pool Paged Bytes','\\Memory\\Pool Nonpaged Bytes'; "
                "$installed = ($modules | Measure-Object Capacity -Sum).Sum; "
                "$speed = ($modules | Where-Object Speed | Measure-Object Speed -Maximum).Maximum; "
                "$formMap = @{ 8='DIMM'; 9='SIP'; 12='SODIMM'; 13='Chip' }; "
                "$typeMap = @{ 20='DDR'; 21='DDR2'; 24='DDR3'; 26='DDR4'; 34='DDR5' }; "
                "$formCode = ($modules | Select-Object -First 1 -ExpandProperty FormFactor); "
                "$memoryTypeCode = ($modules | Select-Object -First 1 -ExpandProperty SMBIOSMemoryType); "
                "$result = [ordered]@{ "
                "CacheBytes = [int64](($counters.CounterSamples | Where-Object { $_.Path -like '*Cache Bytes' } | Select-Object -First 1).CookedValue); "
                "CommitUsedBytes = [int64](($counters.CounterSamples | Where-Object { $_.Path -like '*Committed Bytes' } | Select-Object -First 1).CookedValue); "
                "CommitLimitBytes = [int64](($counters.CounterSamples | Where-Object { $_.Path -like '*Commit Limit' } | Select-Object -First 1).CookedValue); "
                "PagedPoolBytes = [int64](($counters.CounterSamples | Where-Object { $_.Path -like '*Pool Paged Bytes' } | Select-Object -First 1).CookedValue); "
                "NonpagedPoolBytes = [int64](($counters.CounterSamples | Where-Object { $_.Path -like '*Pool Nonpaged Bytes' } | Select-Object -First 1).CookedValue); "
                "SlotsUsed = $modules.Count; "
                "SlotsTotal = if ($array) { [int]$array.MemoryDevices } else { $null }; "
                "SpeedMTps = if ($speed) { [int]$speed } else { $null }; "
                "InstalledBytes = if ($installed) { [int64]$installed } else { $null }; "
                "FormFactor = if ($formMap.ContainsKey([int]$formCode)) { $formMap[[int]$formCode] } else { $null }; "
                "MemoryType = if ($typeMap.ContainsKey([int]$memoryTypeCode)) { $typeMap[[int]$memoryTypeCode] } else { $null } "
                "}; $result | ConvertTo-Json -Compress"
            )
            details: dict[str, Any] = {}
            if memory_detail_output:
                try:
                    parsed_details = json.loads(memory_detail_output)
                    if isinstance(parsed_details, dict):
                        details = parsed_details
                except ValueError:
                    details = {}
            def _opt_int(value: Any) -> int | None:
                if value is None:
                    return None
                try:
                    return int(value)
                except (TypeError, ValueError):
                    return None

            installed_bytes = _opt_int(details.get("InstalledBytes"))
            hardware_reserved_bytes = None
            if installed_bytes is not None and installed_bytes >= total_bytes:
                hardware_reserved_bytes = installed_bytes - total_bytes
            return {
                "total_bytes": total_bytes,
                "used_bytes": used_bytes,
                "usage_percent": usage_percent,
                "available_bytes": free_bytes,
                "cached_bytes": _opt_int(details.get("CacheBytes")),
                "commit_used_bytes": _opt_int(details.get("CommitUsedBytes")),
                "commit_limit_bytes": _opt_int(details.get("CommitLimitBytes")),
                "paged_pool_bytes": _opt_int(details.get("PagedPoolBytes")),
                "nonpaged_pool_bytes": _opt_int(details.get("NonpagedPoolBytes")),
                "speed_mtps": _opt_int(details.get("SpeedMTps")),
                "slots_used": _opt_int(details.get("SlotsUsed")),
                "slots_total": _opt_int(details.get("SlotsTotal")),
                "form_factor": details.get("FormFactor"),
                "memory_type": details.get("MemoryType"),
                "installed_bytes": installed_bytes,
                "hardware_reserved_bytes": hardware_reserved_bytes,
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
        "available_bytes": None,
        "cached_bytes": None,
        "commit_used_bytes": None,
        "commit_limit_bytes": None,
        "paged_pool_bytes": None,
        "nonpaged_pool_bytes": None,
        "speed_mtps": None,
        "slots_used": None,
        "slots_total": None,
        "form_factor": None,
        "memory_type": None,
        "installed_bytes": None,
        "hardware_reserved_bytes": None,
    }


def collect_primary_network(settings: AgentSettings, *, track_rate: bool = True) -> dict[str, Any]:
    if os.name != "nt":
        return {}

    network_output = _run_powershell(
        "$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | "
        "Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1; "
        "if (-not $route) { return }; "
        "$adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue; "
        "$ip = Get-NetIPConfiguration -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue; "
        "$stats = Get-NetAdapterStatistics -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue; "
        "$wlan = netsh wlan show interfaces 2>$null; "
        "$ssid = $null; $signal = $null; $radio = $null; "
        "if ($wlan) { "
        "  foreach ($line in ($wlan -split \"`n\")) { "
        "    if ($line -match '^\\s*SSID\\s*:\\s*(.+)$' -and $line -notmatch 'BSSID') { $ssid = $Matches[1].Trim() } "
        "    elseif ($line -match '^\\s*Signal\\s*:\\s*(.+)$') { $signal = $Matches[1].Trim() } "
        "    elseif ($line -match '^\\s*Radio type\\s*:\\s*(.+)$') { $radio = $Matches[1].Trim() } "
        "  } "
        "} "
        "$result = [ordered]@{ "
        "AdapterName = if ($adapter) { $adapter.Name } else { $null }; "
        "InterfaceDescription = if ($adapter) { $adapter.InterfaceDescription } else { $null }; "
        "LinkSpeed = if ($adapter) { $adapter.LinkSpeed } else { $null }; "
        "MacAddress = if ($adapter) { $adapter.MacAddress } else { $null }; "
        "IPv4Address = if ($ip -and $ip.IPv4Address) { $ip.IPv4Address[0].IPAddress } else { $null }; "
        "IPv6Address = if ($ip -and $ip.IPv6Address) { $ip.IPv6Address[0].IPAddress } else { $null }; "
        "SentBytes = if ($stats) { [int64]$stats.SentBytes } else { $null }; "
        "ReceivedBytes = if ($stats) { [int64]$stats.ReceivedBytes } else { $null }; "
        "SSID = $ssid; Signal = $signal; RadioType = $radio "
        "}; $result | ConvertTo-Json -Compress"
    )
    if not network_output:
        return {}

    try:
        current = json.loads(network_output)
    except ValueError:
        return {}
    if not isinstance(current, dict):
        return {}

    tx_bps = None
    rx_bps = None
    if track_rate:
        state_path = settings.state_dir / "network_stats.json"
        previous = load_json(state_path, {})
        now_ns = time.time_ns()
        current["timestamp_ns"] = now_ns

        if isinstance(previous, dict):
            prev_ts = previous.get("timestamp_ns")
            prev_sent = previous.get("SentBytes")
            prev_recv = previous.get("ReceivedBytes")
            curr_sent = current.get("SentBytes")
            curr_recv = current.get("ReceivedBytes")
            if all(isinstance(v, int) for v in (prev_ts, prev_sent, prev_recv, curr_sent, curr_recv)):
                delta_seconds = max((now_ns - prev_ts) / 1_000_000_000, 0)
                if delta_seconds > 0:
                    tx_bps = max((curr_sent - prev_sent) / delta_seconds, 0)
                    rx_bps = max((curr_recv - prev_recv) / delta_seconds, 0)

        save_json(state_path, current)

    return {
        "adapter_name": current.get("AdapterName"),
        "interface_description": current.get("InterfaceDescription"),
        "link_speed": current.get("LinkSpeed"),
        "mac_address": current.get("MacAddress"),
        "ipv4_address": current.get("IPv4Address"),
        "ipv6_address": current.get("IPv6Address"),
        "ssid": current.get("SSID"),
        "signal": current.get("Signal"),
        "radio_type": current.get("RadioType"),
        "tx_bytes_per_sec": round(tx_bps, 2) if tx_bps is not None else None,
        "rx_bytes_per_sec": round(rx_bps, 2) if rx_bps is not None else None,
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
            "utilization.encoder",
            "utilization.decoder",
            "temperature.gpu",
            "power.draw",
            "power.limit",
            "clocks.current.graphics",
            "clocks.max.graphics",
            "clocks.current.video",
            "fan.speed",
            "pcie.link.gen.current",
            "pcie.link.width.current",
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
        if len(parts) < 8:
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
                "encoder_utilization_percent": _float(5),
                "decoder_utilization_percent": _float(6),
                "temperature_c": _float(7),
                "power_draw_w": _float(8),
                "power_limit_w": _float(9),
                "clock_graphics_mhz": _int(10),
                "clock_max_graphics_mhz": _int(11),
                "clock_video_mhz": _int(12),
                "fan_speed_percent": _int(13),
                "pcie_gen": _int(14),
                "pcie_width": _int(15),
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

from __future__ import annotations

from typing import Any, Protocol

from gpufleet_node_agent.api_client import post_signed_json
from gpufleet_node_agent.collect import collect_task_runtime
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.fingerprint import get_cached as get_cached_fingerprint


class SampleDrain(Protocol):
    def drain(self) -> list[dict[str, Any]]: ...


def _latest_sample(samples: list[dict[str, Any]]) -> dict[str, Any] | None:
    for sample in reversed(samples):
        if isinstance(sample, dict):
            return sample
    return None


def _merge_live_sample_metrics(
    fingerprint: dict[str, Any],
    samples: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Overlay the newest 1s sample onto cached fingerprint metadata.

    Fingerprint collection is intentionally slow and infrequent, but the detail
    page's "latest" card needs live utilization values. Keep static metadata
    from the fingerprint and patch only volatile counters from the newest sample.
    """
    cpu = dict(fingerprint["cpu"])
    memory = dict(fingerprint["memory"])
    gpus = [dict(gpu) for gpu in fingerprint["gpus"]]
    extra = dict(fingerprint["extra"])
    latest = _latest_sample(samples)
    if latest is None:
        return cpu, memory, gpus, extra

    cpu_percent = latest.get("cpu_percent")
    if cpu_percent is not None:
        cpu["usage_percent"] = cpu_percent
    per_core = latest.get("per_core_percent")
    if isinstance(per_core, list) and per_core:
        cpu["per_core_percent"] = per_core
    cpu_current_clock_mhz = latest.get("cpu_current_clock_mhz")
    if cpu_current_clock_mhz is not None:
        cpu["current_clock_mhz"] = cpu_current_clock_mhz

    memory_percent = latest.get("memory_percent")
    if memory_percent is not None:
        memory["usage_percent"] = memory_percent
    memory_used_bytes = latest.get("memory_used_bytes")
    if memory_used_bytes is not None:
        memory["used_bytes"] = memory_used_bytes
    memory_available_bytes = latest.get("memory_available_bytes")
    if memory_available_bytes is not None:
        memory["available_bytes"] = memory_available_bytes

    gpus_by_index = {int(gpu.get("index", idx)): gpu for idx, gpu in enumerate(gpus)}
    for sample_gpu in latest.get("gpus") or []:
        if not isinstance(sample_gpu, dict):
            continue
        idx = sample_gpu.get("idx")
        if idx is None:
            continue
        gpu = gpus_by_index.get(int(idx))
        if gpu is None:
            continue
        if sample_gpu.get("util") is not None:
            gpu["utilization_percent"] = sample_gpu["util"]
        if sample_gpu.get("temp_c") is not None:
            gpu["temperature_c"] = sample_gpu["temp_c"]
        if sample_gpu.get("vram_used_bytes") is not None:
            gpu["used_vram_mb"] = int(round(float(sample_gpu["vram_used_bytes"]) / (1024 * 1024)))
        if sample_gpu.get("power_w") is not None:
            gpu["power_draw_w"] = sample_gpu["power_w"]

    upload_bps = latest.get("upload_bps")
    download_bps = latest.get("download_bps")
    if upload_bps is not None or download_bps is not None:
        network = dict(extra.get("network") or {})
        if upload_bps is not None:
            network["tx_bytes_per_sec"] = upload_bps
        if download_bps is not None:
            network["rx_bytes_per_sec"] = download_bps
        extra["network"] = network

    return cpu, memory, gpus, extra


def build_heartbeat_payload(
    settings: AgentSettings,
    sample_buffer: SampleDrain | None = None,
) -> dict[str, Any]:
    """构造心跳 payload — 从 fingerprint 缓存读 + drain sample buffer + 实时 task_runtime.

    设计要点 (痛改前耻):
    - 静态画像从 fingerprint 缓存读, 再用最新高密 sample 覆盖动态 CPU / memory / GPU / 网速.
      不再每次心跳调 collect_cpu / collect_gpus 等慢路径 (它们启动 4 个 PowerShell + nvidia-smi 共 ~15 秒).
    - task_runtime 仍每次重新拿 (反映"现在哪个 task 在跑", 是真实时业务状态, 不是画像).
    - samples 仍由 sample_buffer.drain() 提供.
    - 这一整个 build 应在 < 50ms 完成.
    """
    fingerprint = get_cached_fingerprint(settings)
    samples = sample_buffer.drain() if sample_buffer is not None else []
    cpu, memory, gpus, extra = _merge_live_sample_metrics(fingerprint, samples)

    payload: dict[str, Any] = {
        # 来自指纹缓存
        "boot_id": fingerprint["boot_id"],
        "agent_version": fingerprint["agent_version"],
        "hostname": fingerprint["hostname"],
        "heartbeat_interval_sec": fingerprint["heartbeat_interval_sec"],
        "sample_interval_sec": fingerprint["sample_interval_sec"] if sample_buffer is not None else None,
        "cpu": cpu,
        "memory": memory,
        "disks": fingerprint["disks"],
        "gpus": gpus,
        "nvidia": fingerprint["nvidia"],
        "python_env": fingerprint["python_env"],
        "extra": extra,
        # 实时业务状态
        "task_runtime": collect_task_runtime(settings),
        # 探针 sample
        "samples": samples,
    }
    return payload


def send_heartbeat(
    settings: AgentSettings,
    sample_buffer: SampleDrain | None = None,
) -> dict[str, Any]:
    payload = build_heartbeat_payload(settings, sample_buffer=sample_buffer)
    return post_signed_json(settings, "/api/v1/node/heartbeat", payload, timeout=30)

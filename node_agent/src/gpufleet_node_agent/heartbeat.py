from __future__ import annotations

from typing import Any

from gpufleet_node_agent.api_client import post_signed_json
from gpufleet_node_agent.collect import collect_task_runtime
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.fingerprint import get_cached as get_cached_fingerprint
from gpufleet_node_agent.sampler import SampleRingBuffer


def build_heartbeat_payload(
    settings: AgentSettings,
    sample_buffer: SampleRingBuffer | None = None,
) -> dict[str, Any]:
    """构造心跳 payload — 从 fingerprint 缓存读 + drain sample buffer + 实时 task_runtime.

    设计要点 (痛改前耻):
    - cpu / memory / disks / gpus / nvidia / python_env / extra **直接抄 fingerprint 缓存** (内存读, 微秒级),
      不再每次心跳调 collect_cpu / collect_gpus 等 (它们启动 4 个 PowerShell + nvidia-smi 共 ~15 秒).
    - task_runtime 仍每次重新拿 (反映"现在哪个 task 在跑", 是真实时业务状态, 不是画像).
    - samples 仍由 sample_buffer.drain() 提供.
    - 这一整个 build 应在 < 50ms 完成.
    """
    fingerprint = get_cached_fingerprint(settings)

    payload: dict[str, Any] = {
        # 来自指纹缓存
        "boot_id": fingerprint["boot_id"],
        "agent_version": fingerprint["agent_version"],
        "hostname": fingerprint["hostname"],
        "heartbeat_interval_sec": fingerprint["heartbeat_interval_sec"],
        "sample_interval_sec": fingerprint["sample_interval_sec"] if sample_buffer is not None else None,
        "cpu": fingerprint["cpu"],
        "memory": fingerprint["memory"],
        "disks": fingerprint["disks"],
        "gpus": fingerprint["gpus"],
        "nvidia": fingerprint["nvidia"],
        "python_env": fingerprint["python_env"],
        "extra": fingerprint["extra"],
        # 实时业务状态
        "task_runtime": collect_task_runtime(settings),
        # 探针 sample
        "samples": sample_buffer.drain() if sample_buffer is not None else [],
    }
    return payload


def send_heartbeat(
    settings: AgentSettings,
    sample_buffer: SampleRingBuffer | None = None,
) -> dict[str, Any]:
    payload = build_heartbeat_payload(settings, sample_buffer=sample_buffer)
    return post_signed_json(settings, "/api/v1/node/heartbeat", payload, timeout=30)

"""节点指纹缓存 (设计来源: docs/Probe_Rewrite_Plan.md, 已冻结).

平时节点心跳 payload 顶层的 cpu / memory / disks / gpus / nvidia / python_env / extra 等"画像"
字段直接从这里的内存缓存读, 不重新探测.

手动 refresh 通道:
- 服务端通过 HeartbeatResponse.refresh_fingerprint = True 通知节点
- cli.py 主循环看到 True 后调 mark_dirty()
- 后台 daemon 线程接管异步重采, 更新缓存
- 下一次心跳 (5s 后) payload 就带新指纹
"""

from __future__ import annotations

import logging
import platform
import time
from copy import deepcopy
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any

from gpufleet_node_agent.collect import (
    collect_cpu,
    collect_disks,
    collect_gpus,
    collect_memory,
    collect_nvidia,
    collect_primary_network,
    collect_python_env,
    get_boot_id,
)
from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.modal_support import collect_modal_runtime_status


logger = logging.getLogger(__name__)


_cache: dict[str, Any] | None = None
_cache_lock = Lock()
_dirty_event = Event()
_refresh_worker_started = False
_worker_lock = Lock()


def collect_full_fingerprint(settings: AgentSettings) -> dict[str, Any]:
    """跑一次完整画像采集. **重型**: Windows 上 ~10-15 秒.

    包括: boot_id / agent_version / hostname / heartbeat_interval_sec / sample_interval_sec /
    cpu / memory / disks / gpus / nvidia / python_env / extra
    其中 extra 含 platform / deployment_mode / network / modal_runtime.
    task_runtime 不在此处采 (它每次心跳都要刷新, 反映"现在哪个 task 在跑").
    """
    return {
        "boot_id": get_boot_id(settings),
        "agent_version": "0.2.0",
        "hostname": platform.node(),
        "heartbeat_interval_sec": settings.heartbeat_interval_sec,
        "sample_interval_sec": settings.sample_interval_sec,
        "cpu": collect_cpu(),
        "memory": collect_memory(),
        "disks": collect_disks(settings),
        "gpus": collect_gpus(),
        "nvidia": collect_nvidia(),
        "python_env": collect_python_env(settings),
        "extra": {
            "agent_root": str(Path(settings.agent_root).resolve()),
            "platform": platform.platform(),
            "deployment_mode": settings.deployment_mode,
            "effective_deployment_mode": settings.effective_deployment_mode(),
            "network": collect_primary_network(settings),
            "modal_runtime": collect_modal_runtime_status(settings),
        },
    }


def get_cached(settings: AgentSettings) -> dict[str, Any]:
    """读缓存. 第一次访问时同步跑一次 collect_full_fingerprint (启动期接受这一次性投资).

    返回深拷贝, 避免外部修改污染缓存.
    """
    global _cache
    with _cache_lock:
        if _cache is None:
            logger.info("fingerprint_initial_collect_start")
            t0 = time.time()
            _cache = collect_full_fingerprint(settings)
            elapsed = time.time() - t0
            logger.info("fingerprint_initial_collect_done elapsed_sec=%.2f", elapsed)
        return deepcopy(_cache)


def mark_dirty() -> None:
    """触发后台 worker 重采. 由 cli.py 在收到 server refresh_fingerprint 指令时调."""
    _dirty_event.set()
    logger.info("fingerprint_marked_dirty")


def _refresh_worker(settings: AgentSettings, stop_event: Event) -> None:
    """daemon: 等 dirty event 触发, 重跑 collect_full_fingerprint, 更新 _cache.

    用 stop_event.wait + _dirty_event 的双事件: 任一触发都返回, 区分 shutdown vs refresh.
    """
    global _cache
    while not stop_event.is_set():
        # wait for either dirty signal or shutdown (poll 1s 避免 dirty_event 错过 timing)
        triggered = _dirty_event.wait(timeout=1.0)
        if stop_event.is_set():
            return
        if not triggered:
            continue
        _dirty_event.clear()

        try:
            logger.info("fingerprint_refresh_start")
            t0 = time.time()
            new_fp = collect_full_fingerprint(settings)
            elapsed = time.time() - t0
            with _cache_lock:
                _cache = new_fp
            logger.info("fingerprint_refresh_done elapsed_sec=%.2f", elapsed)
        except Exception:  # noqa: BLE001
            logger.exception("fingerprint_refresh_failed")


def start_refresh_worker(settings: AgentSettings, stop_event: Event) -> Thread | None:
    """启动后台 refresh 线程. 只启一次 (重复调用安全)."""
    global _refresh_worker_started
    with _worker_lock:
        if _refresh_worker_started:
            return None
        _refresh_worker_started = True
    thread = Thread(
        target=_refresh_worker,
        args=(settings, stop_event),
        name="gpufleet-fingerprint-refresh",
        daemon=True,
    )
    thread.start()
    return thread

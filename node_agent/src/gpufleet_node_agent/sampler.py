"""节点高密探针: 1s 本地采集 → 内存 ring buffer, 5s 心跳批量上传.

设计来源: docs/Heartbeat_HighDensity_Sampling_Design.md (已冻结)
                + docs/Probe_Rewrite_Plan.md (2026-06-16)

关键原则 (痛改前耻):
- **绝不启动子进程** (不调 PowerShell / typeperf / nvidia-smi / wmic)
- 全部用 psutil (Python C 扩展, 直读性能计数器) + pynvml (NVIDIA C 库)
- 单轮 collect_sample() 应 < 10ms
- 完整画像 (CPU 型号 / 虚拟化 / GPU 型号 等) 由 fingerprint.py 在启动时跑一次缓存,
  sampler 这里只拿"数值型 metric"
"""

from __future__ import annotations

import logging
import time
from collections import deque
from datetime import datetime, timezone
from threading import Event, Lock, Thread
from typing import Any

import psutil

try:
    import pynvml
    _NVML_AVAILABLE = True
except Exception:  # noqa: BLE001
    _NVML_AVAILABLE = False


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# NVML 句柄缓存 (启动时一次性 init, 每次采样直接读)
# ---------------------------------------------------------------------------

_NVML_HANDLES: list[Any] = []
_NVML_INITIALIZED = False


def _init_nvml() -> None:
    """node_agent 启动时调一次. 失败不抛 (纯 CPU 节点 / Modal runner 没 NVIDIA 也要能跑)."""
    global _NVML_INITIALIZED
    if _NVML_INITIALIZED or not _NVML_AVAILABLE:
        return
    try:
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        for i in range(count):
            _NVML_HANDLES.append(pynvml.nvmlDeviceGetHandleByIndex(i))
        _NVML_INITIALIZED = True
        logger.info("nvml_init_ok gpu_count=%d", count)
    except Exception:
        logger.info("nvml_init_skipped (no NVIDIA driver / non-GPU node)")


def _collect_gpus_lite() -> list[dict[str, Any]]:
    """毫秒级 GPU 探针. NVML 不可用时返空数组."""
    if not _NVML_INITIALIZED:
        return []
    result: list[dict[str, Any]] = []
    for idx, handle in enumerate(_NVML_HANDLES):
        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            try:
                power_mw = pynvml.nvmlDeviceGetPowerUsage(handle)  # milliwatts
                power_w: float | None = round(power_mw / 1000.0, 2)
            except Exception:  # noqa: BLE001 - 某些显卡不支持 power readback
                power_w = None
            result.append({
                "idx": idx,
                "util": float(util.gpu),
                "temp_c": float(temp),
                "vram_used_bytes": int(mem.used),
                "power_w": power_w,
            })
        except Exception:  # noqa: BLE001
            # 某次读取失败就跳过这张卡, 别拖垮整轮采样
            continue
    return result


# ---------------------------------------------------------------------------
# 采样主函数 (探针层)
# ---------------------------------------------------------------------------

# psutil.cpu_percent(interval=None) 首次调用是"自上次以来的平均", 第一次返 0.
# 启动时先调一次丢弃 (StarTrack 同款约定).
_PSUTIL_PRIMED = False


def _prime_psutil() -> None:
    """首次调用 psutil.cpu_percent(interval=None) 返 0, 启动时先 prime 一次."""
    global _PSUTIL_PRIMED
    if _PSUTIL_PRIMED:
        return
    try:
        psutil.cpu_percent(interval=None)
        psutil.net_io_counters()
    except Exception:  # noqa: BLE001
        pass
    _PSUTIL_PRIMED = True


def collect_sample() -> dict[str, Any]:
    """一次轻量采样 — 探针层. 整轮目标 < 10ms.

    设计要点 (参考 StarTrack agent_new.py):
    - psutil.cpu_percent(interval=None): 非阻塞瞬时值, 与上次调用的差值
    - psutil.virtual_memory().percent: 瞬时
    - pynvml C 调用: 毫秒级
    - net_io_counters() 差值算 bps 不在这一层做 (在 SampleRingBuffer 内做, 因为需要上次值)
    """
    return {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "cpu_percent": round(psutil.cpu_percent(interval=None), 2),
        "memory_percent": round(psutil.virtual_memory().percent, 2),
        "gpus": _collect_gpus_lite(),
    }


# ---------------------------------------------------------------------------
# Thread-safe ring buffer (+ net io counter 状态)
# ---------------------------------------------------------------------------


class SampleRingBuffer:
    """容量上限 deque, 心跳时 drain 取走全部累积 sample.

    顺手在 push 时算网速 bps (psutil.net_io_counters 差值), 塞进 sample dict.
    满了自动丢最旧, 不报错.
    """

    def __init__(self, capacity: int = 5) -> None:
        if capacity < 1:
            raise ValueError(f"capacity must be >= 1, got {capacity}")
        self._buf: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._lock = Lock()
        # 网速 bps 算差值需要上次的 io counters + timestamp
        self._last_net_io: Any = None
        self._last_net_time: float | None = None

    def _enrich_with_net_bps(self, sample: dict[str, Any]) -> None:
        """在 sample 上塞 upload_bps / download_bps (差值算).

        第一次没有上次值时, upload_bps / download_bps = None (符合"探针刚启动"语义).
        重启 / 计数器回绕导致负差时也视为 None.
        """
        upload_bps: float | None = None
        download_bps: float | None = None
        try:
            now = time.time()
            current_io = psutil.net_io_counters()
            if self._last_net_io is not None and self._last_net_time is not None:
                dt = now - self._last_net_time
                if dt > 0:
                    d_sent = current_io.bytes_sent - self._last_net_io.bytes_sent
                    d_recv = current_io.bytes_recv - self._last_net_io.bytes_recv
                    if d_sent >= 0 and d_recv >= 0:
                        upload_bps = round(d_sent / dt, 2)
                        download_bps = round(d_recv / dt, 2)
            self._last_net_io = current_io
            self._last_net_time = now
        except Exception:  # noqa: BLE001
            pass
        sample["upload_bps"] = upload_bps
        sample["download_bps"] = download_bps

    def push(self, sample: dict[str, Any]) -> None:
        self._enrich_with_net_bps(sample)
        with self._lock:
            self._buf.append(sample)

    def drain(self) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._buf)
            self._buf.clear()
            return items

    def __len__(self) -> int:
        with self._lock:
            return len(self._buf)


# ---------------------------------------------------------------------------
# Sampler daemon thread
# ---------------------------------------------------------------------------


def start_sampler(
    buf: SampleRingBuffer,
    stop_event: Event,
    sample_interval_sec: float,
) -> Thread:
    """启动 daemon 线程, 每 sample_interval_sec 跑一次 collect_sample.

    单次异常 log warning 但不中断循环.
    """
    # 启动时一次性 init NVML + prime psutil
    _init_nvml()
    _prime_psutil()

    def loop() -> None:
        while not stop_event.is_set():
            try:
                buf.push(collect_sample())
            except Exception:  # noqa: BLE001
                logger.warning("sampler_tick_failed", exc_info=True)
            stop_event.wait(timeout=sample_interval_sec)

    thread = Thread(target=loop, name="gpufleet-sampler", daemon=True)
    thread.start()
    return thread

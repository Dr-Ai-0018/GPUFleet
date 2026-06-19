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

import ctypes
import logging
import sys
import time
from collections import deque
from ctypes import wintypes
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
    """毫秒级 GPU 探针. NVML 不可用时返空数组; 单卡读取失败时跳过该卡."""
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
            sample = {
                "idx": idx,
                "util": float(util.gpu),
                "temp_c": float(temp),
                "vram_used_bytes": int(mem.used),
                "power_w": power_w,
            }
            result.append(sample)
        except Exception:  # noqa: BLE001
            # 单卡偶发失败时直接跳过, 不在 sampler 层缓存; 基准行/慢路径负责完整画像.
            continue
    return result


# ---------------------------------------------------------------------------
# Windows PDH — 真实 CPU 当前频率
#
# 背景: psutil.cpu_freq() 在 Windows 上只能返回 WMI 基频 (e.g. 2400 MHz),
# 拿不到任务管理器顶上那个实时频率 (受 P-State / Turbo / SpeedShift 影响的真值).
# 走 PDH counter "\Processor Information(_Total)\Processor Frequency" 才能拿到真值.
# 微秒级 (远比 Get-Counter 启动 PowerShell 快), 纯标准库 ctypes, 无新依赖.
#
# Linux/macOS: psutil.cpu_freq() 是准的 (读 sysfs), 走 fallback 即可.
# ---------------------------------------------------------------------------

_PDH_FMT_DOUBLE = 0x00000200
_PDH_ERROR_SUCCESS = 0
_CPU_FREQ_COUNTER_PATH = "\\Processor Information(_Total)\\Processor Frequency"


class _PdhFmtCounterValue(ctypes.Structure):
    _fields_ = [
        ("CStatus", wintypes.DWORD),
        ("doubleValue", ctypes.c_double),
    ]


_pdh_dll: Any | None = None
_pdh_query: ctypes.c_void_p | None = None
_pdh_counter: ctypes.c_void_p | None = None
_pdh_initialized = False


def _init_pdh_cpu_freq() -> None:
    """启动时一次性 init PDH query + counter handle. 仅 Windows; 失败静默 (fallback psutil)."""
    global _pdh_dll, _pdh_query, _pdh_counter, _pdh_initialized
    if _pdh_initialized or sys.platform != "win32":
        return
    try:
        dll = ctypes.WinDLL("pdh")
        # 设置签名, 避免 32/64-bit handle 截断
        dll.PdhOpenQueryW.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
        dll.PdhOpenQueryW.restype = wintypes.DWORD
        dll.PdhAddEnglishCounterW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
        dll.PdhAddEnglishCounterW.restype = wintypes.DWORD
        dll.PdhCollectQueryData.argtypes = [ctypes.c_void_p]
        dll.PdhCollectQueryData.restype = wintypes.DWORD
        dll.PdhGetFormattedCounterValue.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(_PdhFmtCounterValue)]
        dll.PdhGetFormattedCounterValue.restype = wintypes.DWORD
        dll.PdhCloseQuery.argtypes = [ctypes.c_void_p]
        dll.PdhCloseQuery.restype = wintypes.DWORD

        query = ctypes.c_void_p()
        rc = dll.PdhOpenQueryW(None, 0, ctypes.byref(query))
        if rc != _PDH_ERROR_SUCCESS:
            logger.info("pdh_open_query_failed rc=%#x", rc)
            return
        counter = ctypes.c_void_p()
        # PdhAddEnglishCounterW 用字面 English counter path, 不受系统语言 (中文 Windows) 影响
        rc = dll.PdhAddEnglishCounterW(query, _CPU_FREQ_COUNTER_PATH, 0, ctypes.byref(counter))
        if rc != _PDH_ERROR_SUCCESS:
            dll.PdhCloseQuery(query)
            logger.info("pdh_add_counter_failed rc=%#x", rc)
            return
        # prime — 对瞬时 counter 无害, 对 rate counter 是必须的
        dll.PdhCollectQueryData(query)
        _pdh_dll = dll
        _pdh_query = query
        _pdh_counter = counter
        _pdh_initialized = True
        logger.info("pdh_cpu_freq_init_ok")
    except Exception:  # noqa: BLE001
        logger.info("pdh_cpu_freq_init_skipped (DLL missing or non-Windows)")


def _read_current_cpu_freq_mhz() -> int | None:
    """读真实 CPU 当前频率 (MHz). Windows 走 PDH; 其它平台 fallback psutil.cpu_freq."""
    if _pdh_initialized and _pdh_dll is not None and _pdh_query is not None and _pdh_counter is not None:
        try:
            if _pdh_dll.PdhCollectQueryData(_pdh_query) != _PDH_ERROR_SUCCESS:
                return None
            val = _PdhFmtCounterValue()
            rc = _pdh_dll.PdhGetFormattedCounterValue(_pdh_counter, _PDH_FMT_DOUBLE, None, ctypes.byref(val))
            if rc != _PDH_ERROR_SUCCESS or val.CStatus != _PDH_ERROR_SUCCESS:
                return None
            return int(val.doubleValue)
        except Exception:  # noqa: BLE001
            return None
    # Fallback: Linux/macOS 准, Windows 上 PDH init 失败时退回基频(总比 None 好)
    try:
        f = psutil.cpu_freq()
        if f and f.current:
            return round(f.current)
    except Exception:  # noqa: BLE001
        pass
    return None


# ---------------------------------------------------------------------------
# 采样主函数 (探针层)
# ---------------------------------------------------------------------------

# psutil.cpu_percent(interval=None, percpu=True) 首次调用是"自上次以来的平均", 第一次返 0.
# 启动时先调一次丢弃 (StarTrack 同款约定).
_PSUTIL_PRIMED = False


def _prime_psutil() -> None:
    """首次调用 psutil.cpu_percent(..., percpu=True) 返 0, 启动时先 prime 一次."""
    global _PSUTIL_PRIMED
    if _PSUTIL_PRIMED:
        return
    try:
        psutil.cpu_percent(interval=None, percpu=True)
        psutil.net_io_counters()
    except Exception:  # noqa: BLE001
        pass
    _PSUTIL_PRIMED = True


def collect_sample() -> dict[str, Any]:
    """一次轻量采样 — 探针层. 整轮目标 < 10ms.

    设计要点 (参考 StarTrack agent_new.py):
    - psutil.cpu_percent(interval=None, percpu=True): 非阻塞瞬时值, 与上次调用的差值.
      total 从 per-core 派生, 避免连续调用 psutil 重置内部缓存导致第二次全 0.
    - psutil.virtual_memory().percent: 瞬时
    - pynvml C 调用: 毫秒级
    - net_io_counters() 差值算 bps 不在这一层做 (在 SampleRingBuffer 内做, 因为需要上次值)
    """
    per_core = psutil.cpu_percent(interval=None, percpu=True)
    per_core_percent = [round(v, 2) for v in per_core]
    cpu_percent = round(sum(per_core_percent) / len(per_core_percent), 2) if per_core_percent else 0.0
    memory = psutil.virtual_memory()

    return {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "cpu_percent": cpu_percent,
        "per_core_percent": per_core_percent,
        "cpu_current_clock_mhz": _read_current_cpu_freq_mhz(),
        "memory_percent": round(memory.percent, 2),
        "memory_used_bytes": int(memory.used),
        "memory_available_bytes": int(memory.available),
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
    # 启动时一次性 init NVML + prime psutil + 打开 PDH counter (Windows 真实 CPU 频率)
    _init_nvml()
    _prime_psutil()
    _init_pdh_cpu_freq()

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


class Sampler:
    """高密采样器: 后台线程写 ring buffer, 心跳侧 drain 后清空."""

    def __init__(
        self,
        sample_interval_sec: float = 1.0,
        sample_buffer_size: int = 5,
        stop_event: Event | None = None,
    ) -> None:
        self.sample_interval_sec = sample_interval_sec
        self.buffer = SampleRingBuffer(capacity=sample_buffer_size)
        self._stop_event = stop_event or Event()
        self._thread: Thread | None = None

    def start(self) -> Sampler:
        if self._thread is None or not self._thread.is_alive():
            self._thread = start_sampler(self.buffer, self._stop_event, self.sample_interval_sec)
        return self

    def drain(self) -> list[dict[str, Any]]:
        return self.buffer.drain()

    def shutdown(self, timeout: float = 2.0) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)

    def __enter__(self) -> Sampler:
        return self.start()

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        self.shutdown()

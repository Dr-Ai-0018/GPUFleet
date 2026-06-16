"""节点高密采样: 1s 本地采集 → 内存 ring buffer, 5s 心跳批量上传.

设计来源: docs/Heartbeat_HighDensity_Sampling_Design.md (已冻结)

时间分辨率 5×, 网络/服务端开销不变. ring buffer 不持久化, 节点崩溃丢 ≤ 5s 数据可接受.
"""

from __future__ import annotations

import logging
from collections import deque
from datetime import datetime, timezone
from threading import Event, Lock, Thread
from typing import Any

from gpufleet_node_agent.collect import collect_cpu, collect_gpus, collect_memory


logger = logging.getLogger(__name__)


def _MiB_to_bytes(value: int | None) -> int | None:
    """MiB → bytes. collect_gpus() 返回的 used_vram_mb 实为 MiB, 与服务端 sample 字段单位对齐."""
    return value * 1024 * 1024 if value is not None else None


def collect_sample() -> dict[str, Any]:
    """一次采样: 取 CPU / 内存 / 全部 GPU 卡的瞬时数值字段.

    设计要点: 只取"数值型 metric", 不取元数据 (disks/python_env/task_runtime 等).
    多 GPU 完整覆盖, 不只装 GPU0 (人类决策: 不能赌只有 GPU0).
    """
    cpu = collect_cpu()
    mem = collect_memory()
    gpus = collect_gpus()
    return {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "cpu_percent": cpu.get("usage_percent"),
        "memory_percent": mem.get("usage_percent"),
        "gpus": [
            {
                "idx": g.get("index", i),
                "util": g.get("utilization_percent"),
                "temp_c": g.get("temperature_c"),
                "vram_used_bytes": _MiB_to_bytes(g.get("used_vram_mb")),
            }
            for i, g in enumerate(gpus)
        ],
    }


class SampleRingBuffer:
    """thread-safe 容量上限 deque, 不持久化.

    心跳 thread 调 drain() 取走全部累积 sample 并清空; sampler thread 调 push() 追加.
    超过 capacity 时自动丢最旧 (心跳延迟超过预期窗口的兜底).
    """

    def __init__(self, capacity: int = 5) -> None:
        if capacity < 1:
            raise ValueError(f"capacity must be >= 1, got {capacity}")
        self._buf: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._lock = Lock()

    def push(self, sample: dict[str, Any]) -> None:
        with self._lock:
            self._buf.append(sample)

    def drain(self) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._buf)
            self._buf.clear()
            return items

    def __len__(self) -> int:  # 方便测试断言
        with self._lock:
            return len(self._buf)


def start_sampler(
    buf: SampleRingBuffer,
    stop_event: Event,
    sample_interval_sec: float,
) -> Thread:
    """启动 daemon 线程, 每 sample_interval_sec 跑一次采集.

    单次采集异常会 log warning 但不中断 loop (避免某次 collect_gpus pynvml 抖动污染整批).
    stop_event.set() 后 thread 立即退出.
    """

    def loop() -> None:
        while not stop_event.is_set():
            try:
                buf.push(collect_sample())
            except Exception:  # noqa: BLE001 - 故意宽接, 单 tick 异常不能拖垮 sampler
                logger.warning("sampler tick failed, skipping this sample", exc_info=True)
            stop_event.wait(timeout=sample_interval_sec)

    thread = Thread(target=loop, name="gpufleet-sampler", daemon=True)
    thread.start()
    return thread

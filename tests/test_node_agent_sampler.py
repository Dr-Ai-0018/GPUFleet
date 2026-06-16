"""节点高密采样: 1s 本地采集 → ring buffer → 5s 心跳批量上传, 节点端验收.

设计来源: docs/Heartbeat_HighDensity_Sampling_Design.md (任务 B)
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from threading import Event

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

from gpufleet_node_agent.sampler import (  # noqa: E402
    SampleRingBuffer,
    _MiB_to_bytes,
    collect_sample,
    start_sampler,
)


# -----------------------------------------------------------------------------
# SampleRingBuffer 行为
# -----------------------------------------------------------------------------


def test_ringbuffer_push_drain_clears_and_returns_in_order() -> None:
    buf = SampleRingBuffer(capacity=5)
    for i in range(3):
        buf.push({"ts": f"t{i}", "cpu_percent": float(i)})
    drained = buf.drain()
    assert [s["ts"] for s in drained] == ["t0", "t1", "t2"]
    # drain 后应清空
    assert len(buf) == 0
    assert buf.drain() == []


def test_ringbuffer_capacity_overflow_drops_oldest() -> None:
    """容量满后再 push 自动丢最旧, 不抛错."""
    buf = SampleRingBuffer(capacity=3)
    for i in range(5):
        buf.push({"ts": f"t{i}"})
    drained = buf.drain()
    # 容量 3, 进了 5 个, 留下最新 3 个 (t2, t3, t4)
    assert [s["ts"] for s in drained] == ["t2", "t3", "t4"]


def test_ringbuffer_rejects_invalid_capacity() -> None:
    with pytest.raises(ValueError):
        SampleRingBuffer(capacity=0)
    with pytest.raises(ValueError):
        SampleRingBuffer(capacity=-1)


# -----------------------------------------------------------------------------
# collect_sample 的形状 + 多 GPU 字段保留
# -----------------------------------------------------------------------------


def test_collect_sample_shape_and_multi_gpu_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    """mock 出三卡场景, 验证 sample 内 gpus 数组完整保留每卡的 idx/util/temp_c/vram_used_bytes."""
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.collect_cpu",
        lambda: {"usage_percent": 67.5, "load_1": 0.5},
    )
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.collect_memory",
        lambda: {"usage_percent": 48.0, "total_bytes": 16_000_000_000},
    )
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.collect_gpus",
        lambda: [
            {"index": 0, "utilization_percent": 85.0, "temperature_c": 71.5, "used_vram_mb": 12000, "model": "A100"},
            {"index": 1, "utilization_percent": 92.0, "temperature_c": 74.0, "used_vram_mb": 18000, "model": "A100"},
            {"index": 2, "utilization_percent": 65.0, "temperature_c": 69.0, "used_vram_mb": 8000, "model": "A100"},
        ],
    )

    sample = collect_sample()

    # 顶层字段
    assert sample["cpu_percent"] == 67.5
    assert sample["memory_percent"] == 48.0
    assert "ts" in sample and sample["ts"].endswith("+00:00") or "Z" in sample["ts"] or "T" in sample["ts"]

    # 多 GPU 完整保留, 三卡都在
    assert len(sample["gpus"]) == 3
    gpus_by_idx = {g["idx"]: g for g in sample["gpus"]}
    assert set(gpus_by_idx.keys()) == {0, 1, 2}
    assert gpus_by_idx[0]["util"] == 85.0
    assert gpus_by_idx[1]["util"] == 92.0
    assert gpus_by_idx[2]["util"] == 65.0

    # MiB → bytes 转换 (12000 MiB = 12_582_912_000 bytes)
    assert gpus_by_idx[0]["vram_used_bytes"] == 12000 * 1024 * 1024
    assert gpus_by_idx[1]["vram_used_bytes"] == 18000 * 1024 * 1024

    # sample 内不带元数据字段 (disks, python_env 等)
    assert "disks" not in sample
    assert "python_env" not in sample
    assert "nvidia" not in sample


def test_collect_sample_handles_no_gpu(monkeypatch: pytest.MonkeyPatch) -> None:
    """无 GPU 节点 (例如 CPU-only): gpus 数组为空, 不抛错."""
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_cpu", lambda: {"usage_percent": 30.0})
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_memory", lambda: {"usage_percent": 40.0})
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_gpus", lambda: [])

    sample = collect_sample()
    assert sample["cpu_percent"] == 30.0
    assert sample["gpus"] == []


def test_collect_sample_missing_fields_become_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """采集器返 None 字段时 sample 透传 None, 不抛错."""
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_cpu", lambda: {"usage_percent": None})
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_memory", lambda: {"usage_percent": None})
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.collect_gpus",
        lambda: [{"index": 0, "utilization_percent": None, "temperature_c": None, "used_vram_mb": None}],
    )

    sample = collect_sample()
    assert sample["cpu_percent"] is None
    assert sample["memory_percent"] is None
    assert sample["gpus"][0]["util"] is None
    assert sample["gpus"][0]["temp_c"] is None
    assert sample["gpus"][0]["vram_used_bytes"] is None


def test_MiB_to_bytes_handles_none() -> None:
    assert _MiB_to_bytes(None) is None
    assert _MiB_to_bytes(0) == 0
    assert _MiB_to_bytes(1) == 1024 * 1024
    assert _MiB_to_bytes(12000) == 12000 * 1024 * 1024


# -----------------------------------------------------------------------------
# start_sampler thread 行为
# -----------------------------------------------------------------------------


def test_start_sampler_pushes_into_buffer_then_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    """启动后短时间内能向 buffer push 至少 1 个 sample; stop_event.set() 后线程退出."""
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_cpu", lambda: {"usage_percent": 50.0})
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_memory", lambda: {"usage_percent": 50.0})
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_gpus", lambda: [])

    buf = SampleRingBuffer(capacity=10)
    stop_event = Event()
    thread = start_sampler(buf, stop_event, sample_interval_sec=0.05)  # 50ms 间隔加快测试

    try:
        # 等 0.25s, 应该已经 push 了几个 sample
        time.sleep(0.25)
        # buffer 至少含 1 个 (实际 ~3-5 个, 取决于调度)
        drained = buf.drain()
        assert len(drained) >= 1
        for sample in drained:
            assert sample["cpu_percent"] == 50.0
            assert "ts" in sample
    finally:
        stop_event.set()
        thread.join(timeout=2)

    assert not thread.is_alive(), "sampler thread should exit when stop_event is set"


def test_start_sampler_swallows_single_tick_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """单 tick 采集异常应被吞掉, sampler 继续跑."""
    call_count = {"n": 0}

    def flaky_cpu() -> dict:
        call_count["n"] += 1
        if call_count["n"] <= 2:
            raise RuntimeError("simulated psutil hiccup")
        return {"usage_percent": 60.0}

    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_cpu", flaky_cpu)
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_memory", lambda: {"usage_percent": 50.0})
    monkeypatch.setattr("gpufleet_node_agent.sampler.collect_gpus", lambda: [])

    buf = SampleRingBuffer(capacity=10)
    stop_event = Event()
    thread = start_sampler(buf, stop_event, sample_interval_sec=0.05)

    try:
        time.sleep(0.4)  # 给至少 5+ tick 机会
    finally:
        stop_event.set()
        thread.join(timeout=2)

    # 前 2 tick 异常被跳过, 之后应有成功 sample
    drained = buf.drain()
    assert len(drained) >= 1, "after exception ticks, sampler should still push successful samples"
    for sample in drained:
        assert sample["cpu_percent"] == 60.0

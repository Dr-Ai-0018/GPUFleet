"""节点高密探针(psutil/pynvml 重写后)+ ring buffer 验收.

设计来源: docs/Heartbeat_HighDensity_Sampling_Design.md + docs/Probe_Rewrite_Plan.md
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

from gpufleet_node_agent.sampler import (  # noqa: E402
    Sampler,
    SampleRingBuffer,
    collect_sample,
    start_sampler,
)


# -----------------------------------------------------------------------------
# SampleRingBuffer 行为 (跟探针实现无关, API 没变)
# -----------------------------------------------------------------------------


def test_ringbuffer_push_drain_clears_and_returns_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    # mock psutil.net_io_counters 避免真调 OS (push 会调它算 bps)
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.net_io_counters",
        lambda: SimpleNamespace(bytes_sent=0, bytes_recv=0),
    )
    buf = SampleRingBuffer(capacity=5)
    for i in range(3):
        buf.push({"ts": f"t{i}", "cpu_percent": float(i)})
    drained = buf.drain()
    assert [s["ts"] for s in drained] == ["t0", "t1", "t2"]
    assert len(buf) == 0
    assert buf.drain() == []


def test_ringbuffer_capacity_overflow_drops_oldest(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.net_io_counters",
        lambda: SimpleNamespace(bytes_sent=0, bytes_recv=0),
    )
    buf = SampleRingBuffer(capacity=3)
    for i in range(5):
        buf.push({"ts": f"t{i}"})
    drained = buf.drain()
    assert [s["ts"] for s in drained] == ["t2", "t3", "t4"]


def test_ringbuffer_rejects_invalid_capacity() -> None:
    with pytest.raises(ValueError):
        SampleRingBuffer(capacity=0)
    with pytest.raises(ValueError):
        SampleRingBuffer(capacity=-1)


# -----------------------------------------------------------------------------
# 网速 bps 通过 net_io_counters 差值算
# -----------------------------------------------------------------------------


def test_ringbuffer_net_bps_first_push_is_none_second_has_value(monkeypatch: pytest.MonkeyPatch) -> None:
    """第一次 push 没有上次 io counters, upload/download_bps = None;
    第二次差值 / 时间差应得到 bps."""
    counters = iter([
        SimpleNamespace(bytes_sent=1000, bytes_recv=2000),
        SimpleNamespace(bytes_sent=1500, bytes_recv=3000),
    ])
    times = iter([100.0, 101.0])

    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.net_io_counters",
        lambda: next(counters),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.time.time", lambda: next(times))

    buf = SampleRingBuffer(capacity=5)
    s1: dict = {"ts": "t1"}
    buf.push(s1)
    assert s1["upload_bps"] is None
    assert s1["download_bps"] is None

    s2: dict = {"ts": "t2"}
    buf.push(s2)
    # delta_sent=500 / dt=1.0 = 500 bps; delta_recv=1000 / dt=1.0 = 1000 bps
    assert s2["upload_bps"] == 500.0
    assert s2["download_bps"] == 1000.0


# -----------------------------------------------------------------------------
# collect_sample 形状 (mock psutil + pynvml, 不依赖真机硬件)
# -----------------------------------------------------------------------------


def test_collect_sample_uses_psutil_and_pynvml_returns_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    """mock psutil + 模拟 NVML 三卡, 验证 sample 形状."""
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_percent", lambda interval=None, percpu=False: [60.0, 70.0, 80.0, 50.0])
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.virtual_memory",
        lambda: SimpleNamespace(percent=48.0, used=480_000, available=520_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_freq", lambda: SimpleNamespace(current=2750.4))
    # 模拟 NVML init 后的句柄 + 各 API
    fake_handles = [object(), object(), object()]
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_HANDLES", fake_handles)
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_INITIALIZED", True)

    util_seq = [SimpleNamespace(gpu=85), SimpleNamespace(gpu=92), SimpleNamespace(gpu=65)]
    mem_seq = [
        SimpleNamespace(used=12_000_000_000),
        SimpleNamespace(used=18_000_000_000),
        SimpleNamespace(used=8_000_000_000),
    ]
    temp_seq = [71, 74, 69]
    power_seq = [180_000, 240_000, 150_000]  # milliwatts

    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetUtilizationRates",
        lambda h: util_seq[fake_handles.index(h)],
    )
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetMemoryInfo",
        lambda h: mem_seq[fake_handles.index(h)],
    )
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetTemperature",
        lambda h, _kind: temp_seq[fake_handles.index(h)],
    )
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetPowerUsage",
        lambda h: power_seq[fake_handles.index(h)],
    )

    sample = collect_sample()

    # 顶层字段
    assert sample["cpu_percent"] == 65.0
    assert sample["per_core_percent"] == [60.0, 70.0, 80.0, 50.0]
    assert sample["cpu_current_clock_mhz"] == 2750
    assert sample["memory_percent"] == 48.0
    assert sample["memory_used_bytes"] == 480_000
    assert sample["memory_available_bytes"] == 520_000
    assert "ts" in sample
    # 多 GPU 完整保留
    assert len(sample["gpus"]) == 3
    gpus_by_idx = {g["idx"]: g for g in sample["gpus"]}
    assert set(gpus_by_idx.keys()) == {0, 1, 2}
    assert gpus_by_idx[0]["util"] == 85.0
    assert gpus_by_idx[1]["util"] == 92.0
    assert gpus_by_idx[2]["util"] == 65.0
    assert gpus_by_idx[0]["vram_used_bytes"] == 12_000_000_000
    assert gpus_by_idx[0]["temp_c"] == 71.0
    assert gpus_by_idx[0]["power_w"] == 180.0  # 180000 mW / 1000


@pytest.mark.skipif(sys.platform != "win32", reason="PDH 仅 Windows 可用")
def test_pdh_cpu_freq_returns_realistic_value_on_windows() -> None:
    """烟雾测试: Windows 真机上 PDH 应该返回合理的当前频率.

    确保 _init_pdh_cpu_freq + _read_current_cpu_freq_mhz 链路打通,
    PDH counter "Processor Frequency" 真的能读到值, 不是 None 也不是离谱数.

    注意: PDH init 会写一组模块级全局 state, 测试结束必须清理, 否则会污染
    后面 monkey-patch psutil.cpu_freq 的 fallback 测试.
    """
    import gpufleet_node_agent.sampler as s

    saved = (s._pdh_dll, s._pdh_query, s._pdh_counter, s._pdh_initialized)
    try:
        s._init_pdh_cpu_freq()  # 幂等; 已 init 则直接返回
        # prime: 首次 PdhCollectQueryData 后立刻读可能拿到 0, 给一点时间让 counter 累计
        s._read_current_cpu_freq_mhz()
        time.sleep(0.05)
        freq = s._read_current_cpu_freq_mhz()

        # 现代 CPU 基本不会低于 200 MHz (节能档) 或高于 10 GHz (物理极限)
        assert freq is not None, "PDH init 应该成功 (任何 Windows 都内建该 counter)"
        assert 200 <= freq <= 10_000, f"频率 {freq} MHz 不在合理范围"
    finally:
        # 关掉 query handle + 复原全局 state, 不让 PDH init 状态泄漏到后面 fallback 测试
        if s._pdh_dll is not None and s._pdh_query is not None:
            try:
                s._pdh_dll.PdhCloseQuery(s._pdh_query)
            except Exception:  # noqa: BLE001
                pass
        s._pdh_dll, s._pdh_query, s._pdh_counter, s._pdh_initialized = saved


def test_collect_sample_handles_no_nvidia_gpu(monkeypatch: pytest.MonkeyPatch) -> None:
    """非 GPU 节点 (NVML 未 init): gpus 数组为空, 不抛错."""
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_percent", lambda interval=None, percpu=False: [30.0, 40.0])
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.virtual_memory",
        lambda: SimpleNamespace(percent=40.0, used=400_000, available=600_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_freq", lambda: None)
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_HANDLES", [])
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_INITIALIZED", False)

    sample = collect_sample()
    assert sample["cpu_percent"] == 35.0
    assert sample["per_core_percent"] == [30.0, 40.0]
    assert sample["cpu_current_clock_mhz"] is None
    assert sample["memory_percent"] == 40.0
    assert sample["gpus"] == []


def test_collect_sample_reads_cpu_once_with_percpu(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[bool] = []

    def cpu_percent(interval=None, percpu=False):
        calls.append(bool(percpu))
        return [10.0, 30.0]

    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_percent", cpu_percent)
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.virtual_memory",
        lambda: SimpleNamespace(percent=40.0, used=400_000, available=600_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_freq", lambda: None)
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_HANDLES", [])
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_INITIALIZED", False)

    sample = collect_sample()

    assert calls == [True]
    assert sample["cpu_percent"] == 20.0
    assert sample["per_core_percent"] == [10.0, 30.0]


def test_collect_sample_handles_nvml_per_card_failure_skips_failed_card(monkeypatch: pytest.MonkeyPatch) -> None:
    """某张卡 NVML 调用挂掉时跳过该卡, sampler 不缓存上次成功值."""
    from gpufleet_node_agent import sampler

    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_percent", lambda interval=None, percpu=False: [50.0, 70.0])
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.virtual_memory",
        lambda: SimpleNamespace(percent=50.0, used=500_000, available=500_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_freq", lambda: SimpleNamespace(current=2400.0))
    fake_handles = ["h0", "h1"]
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_HANDLES", fake_handles)
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_INITIALIZED", True)

    # 场景: 第一次两卡都成功, 第二次 h0 挂掉
    call_log = {"h0_count": 0}

    def flaky_util(h):
        if h == "h0":
            call_log["h0_count"] += 1
            if call_log["h0_count"] >= 2:
                raise RuntimeError("simulated NVML hiccup on h0 (2nd call)")
            return SimpleNamespace(gpu=42)
        return SimpleNamespace(gpu=80)

    monkeypatch.setattr("gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetUtilizationRates", flaky_util)
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetMemoryInfo",
        lambda h: SimpleNamespace(used=1_000_000_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetTemperature", lambda h, _k: 70)
    monkeypatch.setattr("gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetPowerUsage", lambda h: 100_000)

    # 第一次采样: 两张卡都拿到值, 缓存被填充
    sample1 = sampler.collect_sample()
    assert len(sample1["gpus"]) == 2
    g0_first = {g["idx"]: g for g in sample1["gpus"]}[0]
    assert g0_first["util"] == 42.0

    # 第二次采样: h0 挂掉, sampler 直接跳过失败卡, 不续上次缓存
    sample2 = sampler.collect_sample()
    assert len(sample2["gpus"]) == 1
    assert {g["idx"] for g in sample2["gpus"]} == {1}
    g1_second = {g["idx"]: g for g in sample2["gpus"]}[1]
    assert g1_second["util"] == 80.0  # h1 正常


def test_collect_sample_skips_card_when_no_cache_available(monkeypatch: pytest.MonkeyPatch) -> None:
    """启动后第一次读取就失败 (没有缓存可续) 时跳过该卡."""
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_percent", lambda interval=None, percpu=False: [50.0, 70.0])
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.virtual_memory",
        lambda: SimpleNamespace(percent=50.0, used=500_000, available=500_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_freq", lambda: SimpleNamespace(current=2400.0))
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_HANDLES", ["h0", "h1"])
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_INITIALIZED", True)

    def flaky_util(h):
        if h == "h0":
            raise RuntimeError("first call on h0 fails, no cache")
        return SimpleNamespace(gpu=80)

    monkeypatch.setattr("gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetUtilizationRates", flaky_util)
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetMemoryInfo",
        lambda h: SimpleNamespace(used=1_000_000_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetTemperature", lambda h, _k: 70)
    monkeypatch.setattr("gpufleet_node_agent.sampler.pynvml.nvmlDeviceGetPowerUsage", lambda h: 100_000)

    sample = collect_sample()
    # 没缓存就只能跳过 h0
    assert len(sample["gpus"]) == 1
    assert sample["gpus"][0]["util"] == 80.0


# -----------------------------------------------------------------------------
# start_sampler thread 行为
# -----------------------------------------------------------------------------


def test_start_sampler_pushes_into_buffer_then_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_percent", lambda interval=None, percpu=False: [50.0, 70.0])
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.virtual_memory",
        lambda: SimpleNamespace(percent=50.0, used=500_000, available=500_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_freq", lambda: SimpleNamespace(current=2400.0))
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.net_io_counters",
        lambda: SimpleNamespace(bytes_sent=0, bytes_recv=0),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_HANDLES", [])
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_INITIALIZED", False)

    buf = SampleRingBuffer(capacity=10)
    stop_event = Event()
    thread = start_sampler(buf, stop_event, sample_interval_sec=0.05)

    try:
        time.sleep(0.25)
        drained = buf.drain()
        assert len(drained) >= 1
        for sample in drained:
            assert sample["cpu_percent"] == 60.0
            assert sample["per_core_percent"] == [50.0, 70.0]
            assert "ts" in sample
    finally:
        stop_event.set()
        thread.join(timeout=2)

    assert not thread.is_alive(), "sampler thread should exit when stop_event is set"


def test_start_sampler_swallows_single_tick_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """单 tick 异常吞掉, sampler 继续跑."""
    call_count = {"n": 0}

    def flaky_cpu_percent(interval=None, percpu=False):
        call_count["n"] += 1
        if call_count["n"] <= 2:
            raise RuntimeError("simulated psutil hiccup")
        return [60.0, 80.0]

    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_percent", flaky_cpu_percent)
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.virtual_memory",
        lambda: SimpleNamespace(percent=50.0, used=500_000, available=500_000),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler.psutil.cpu_freq", lambda: SimpleNamespace(current=2400.0))
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.net_io_counters",
        lambda: SimpleNamespace(bytes_sent=0, bytes_recv=0),
    )
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_HANDLES", [])
    monkeypatch.setattr("gpufleet_node_agent.sampler._NVML_INITIALIZED", False)

    buf = SampleRingBuffer(capacity=10)
    stop_event = Event()
    thread = start_sampler(buf, stop_event, sample_interval_sec=0.05)

    try:
        time.sleep(0.4)
    finally:
        stop_event.set()
        thread.join(timeout=2)

    drained = buf.drain()
    assert len(drained) >= 1
    for sample in drained:
        assert sample["cpu_percent"] == 70.0
        assert sample["per_core_percent"] == [60.0, 80.0]


def test_sampler_context_manager_drains_and_shutdown_stops_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.collect_sample",
        lambda: {"ts": time.time(), "cpu_percent": 1.0, "gpus": []},
    )
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.net_io_counters",
        lambda: SimpleNamespace(bytes_sent=0, bytes_recv=0),
    )

    with Sampler(sample_interval_sec=0.05, sample_buffer_size=5) as sampler:
        time.sleep(0.16)
        samples = sampler.drain()
        assert len(samples) >= 2
        assert sampler.drain() == []
        thread = sampler._thread

    assert thread is not None
    assert not thread.is_alive()


def test_sampler_shutdown_does_not_wait_for_next_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.collect_sample",
        lambda: {"ts": time.time(), "cpu_percent": 1.0, "gpus": []},
    )
    monkeypatch.setattr(
        "gpufleet_node_agent.sampler.psutil.net_io_counters",
        lambda: SimpleNamespace(bytes_sent=0, bytes_recv=0),
    )

    sampler = Sampler(sample_interval_sec=10.0, sample_buffer_size=5).start()
    time.sleep(0.05)
    started = time.monotonic()
    sampler.shutdown(timeout=1)

    assert time.monotonic() - started < 1
    assert sampler._thread is not None
    assert not sampler._thread.is_alive()

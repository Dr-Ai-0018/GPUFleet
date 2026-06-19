"""Webhook outlet 验收测试 (D3 任务 C).

设计来源: docs/D3_Observability_Design.md §4
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json

import httpx
import pytest

from app.config import Settings
from app.webhook import WebhookEmitter, _sign


# -----------------------------------------------------------------------------
# helpers
# -----------------------------------------------------------------------------


def _make_settings(**overrides) -> Settings:
    """构造 Settings, 默认装在白名单里的 4 个事件全开."""
    base = {
        "jwt_secret": "test-secret-at-least-32-bytes-long!!",
        "default_admin_password": "x",
        "webhook_url": "https://hook.example.com/in",
        "webhook_secret": "",
        "webhook_events": ["task.failed", "task.lost", "review.escalated", "storage.quota_exceeded", "node.offline", "review.expired"],
        "webhook_timeout_sec": 5,
        "instance_name": "test-instance",
    }
    base.update(overrides)
    return Settings(**base)


# -----------------------------------------------------------------------------
# emit() 静默/过滤行为
# -----------------------------------------------------------------------------


def test_emit_silent_when_webhook_url_empty() -> None:
    """webhook_url 空时 emit() 无副作用 (不入队, 不抛错)."""
    settings = _make_settings(webhook_url="")
    emitter = WebhookEmitter(settings)
    emitter.emit("task.failed", {"task_id": "t-1"})
    assert emitter._queue.qsize() == 0


def test_emit_silent_when_event_not_in_allowed_list() -> None:
    """事件不在 webhook_events 白名单时静默."""
    settings = _make_settings(webhook_events=["task.failed"])  # 只开 task.failed
    emitter = WebhookEmitter(settings)
    emitter.emit("review.escalated", {"task_id": "t-1"})
    assert emitter._queue.qsize() == 0
    emitter.emit("task.failed", {"task_id": "t-2"})
    assert emitter._queue.qsize() == 1


# -----------------------------------------------------------------------------
# 队列容量满时丢最旧
# -----------------------------------------------------------------------------


def test_queue_overflow_drops_oldest() -> None:
    """队列满 (容量 1000) 时新事件 push 进队列, 最旧的被丢."""
    settings = _make_settings()
    emitter = WebhookEmitter(settings)
    # 填满
    for i in range(1000):
        emitter.emit("task.failed", {"task_id": f"t-{i}"})
    assert emitter._queue.qsize() == 1000
    # 第 1001 个 — 应丢最旧 (t-0), 仍保持 1000
    emitter.emit("task.failed", {"task_id": "t-overflow"})
    assert emitter._queue.qsize() == 1000


# -----------------------------------------------------------------------------
# HMAC 签名正确
# -----------------------------------------------------------------------------


def test_sign_produces_correct_sha256_format() -> None:
    body = b'{"event":"task.failed"}'
    secret = "my-secret"
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert _sign(secret, body) == expected


# -----------------------------------------------------------------------------
# 投递成功路径 + payload 结构
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deliver_success_includes_envelope_fields_and_signature() -> None:
    """200 响应时单次投递成功; payload 含 §4.2 全部字段; signed."""
    received = {}

    def handler(request: httpx.Request) -> httpx.Response:
        received["body"] = request.content
        received["headers"] = dict(request.headers)
        received["url"] = str(request.url)
        return httpx.Response(200, text="ok")

    transport = httpx.MockTransport(handler)
    settings = _make_settings(webhook_secret="topsecret")
    async with httpx.AsyncClient(transport=transport) as client:
        emitter = WebhookEmitter(settings, client=client)
        emitter.start()
        try:
            emitter.emit("task.failed", {"task_id": "t-abc", "node_id": "n-xyz"}, severity="warning")
            await asyncio.sleep(0.05)  # 让 worker tick 一次
            await emitter.drain(max_wait_sec=2)
        finally:
            await emitter.aclose()

    assert received, "handler never invoked"
    envelope = json.loads(received["body"])
    assert envelope["event"] == "task.failed"
    assert envelope["severity"] == "warning"
    assert envelope["control_plane"] == "test-instance"
    assert envelope["payload"] == {"task_id": "t-abc", "node_id": "n-xyz"}
    assert "timestamp" in envelope
    # HMAC 签名正确
    expected_sig = _sign("topsecret", received["body"])
    assert received["headers"]["x-signature"] == expected_sig


@pytest.mark.asyncio
async def test_aclose_drains_queued_events_before_cancelling_worker() -> None:
    """lifespan shutdown should give queued webhook events a chance to flush."""
    received: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        received.append(request.content)
        return httpx.Response(200, text="ok")

    transport = httpx.MockTransport(handler)
    settings = _make_settings()
    async with httpx.AsyncClient(transport=transport) as client:
        emitter = WebhookEmitter(settings, client=client)
        emitter.start()
        emitter.emit("task.failed", {"task_id": "t-shutdown"}, severity="warning")
        await emitter.aclose()

    assert len(received) == 1
    assert json.loads(received[0])["payload"] == {"task_id": "t-shutdown"}


@pytest.mark.asyncio
async def test_drain_returns_false_on_timeout() -> None:
    """W4 守卫: drain 接口契约 — 排空返 True, 超时返 False (aclose 用此判断进 grace)."""
    settings = _make_settings()
    emitter = WebhookEmitter(settings)
    # 直接塞队列模拟未排空 (没启 worker, queue 不会被 drain 出)
    emitter.emit("task.failed", {"task_id": "stuck"})
    drained = await emitter.drain(max_wait_sec=0.1)
    assert drained is False


@pytest.mark.asyncio
async def test_aclose_grace_window_lets_slow_inflight_complete() -> None:
    """W4: drain 5s 超时后, in-flight deliver 仍能在 grace (= webhook_timeout_sec)
    内完成, 不被 worker_task.cancel() 砍掉静默丢事件.
    """
    received: list[bytes] = []
    delivery_started = asyncio.Event()

    async def slow_handler(request: httpx.Request) -> httpx.Response:
        delivery_started.set()
        await asyncio.sleep(6.0)  # > drain 5s 超时, < grace 30s
        received.append(request.content)
        return httpx.Response(200, text="ok")

    transport = httpx.MockTransport(slow_handler)
    # webhook_timeout_sec 拉到 30s, 让 deliver 不因 httpx timeout 中断 + grace 充裕
    settings = _make_settings(webhook_timeout_sec=30)
    async with httpx.AsyncClient(transport=transport, timeout=30.0) as client:
        emitter = WebhookEmitter(settings, client=client)
        emitter.start()
        emitter.emit("task.failed", {"task_id": "t-slow"}, severity="warning")
        # 等 worker 进 deliver, 确保 aclose 触发时事件已 in-flight
        await asyncio.wait_for(delivery_started.wait(), timeout=2.0)
        await emitter.aclose()

    assert len(received) == 1, "in-flight event 应在 grace 内完成投递, 而非被 cancel 丢"
    assert json.loads(received[0])["payload"] == {"task_id": "t-slow"}


# -----------------------------------------------------------------------------
# 失败重试 3 次后丢弃, 主流程不阻塞
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deliver_retries_then_drops_on_persistent_5xx(monkeypatch) -> None:
    """连续 500 -> 4 次尝试 (首次 + 3 次退避重试) 后丢弃, 不抛异常."""
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        return httpx.Response(500, text="boom")

    transport = httpx.MockTransport(handler)
    # 加速测试: monkeypatch 退避数组成几乎为 0
    monkeypatch.setattr("app.webhook._RETRY_DELAYS_SEC", (0.01, 0.01, 0.01))
    settings = _make_settings()
    async with httpx.AsyncClient(transport=transport) as client:
        emitter = WebhookEmitter(settings, client=client)
        emitter.start()
        try:
            emitter.emit("task.failed", {"task_id": "t-fail"})
            await asyncio.sleep(0.3)  # 等 4 次重试完成 (4 × 0.01 + 一些 worker tick 时间)
            await emitter.drain(max_wait_sec=2)
        finally:
            await emitter.aclose()

    # 首次 + 3 次重试 = 4 次尝试
    assert attempts["count"] == 4


@pytest.mark.asyncio
async def test_deliver_recovers_on_eventual_success(monkeypatch) -> None:
    """第 1/2 次 500, 第 3 次 200 -> 投递成功后不再重试."""
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] < 3:
            return httpx.Response(500)
        return httpx.Response(200)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr("app.webhook._RETRY_DELAYS_SEC", (0.01, 0.01, 0.01))
    settings = _make_settings()
    async with httpx.AsyncClient(transport=transport) as client:
        emitter = WebhookEmitter(settings, client=client)
        emitter.start()
        try:
            emitter.emit("task.failed", {"task_id": "t-flaky"})
            await asyncio.sleep(0.2)
            await emitter.drain(max_wait_sec=2)
        finally:
            await emitter.aclose()

    # 重试到第 3 次成功就停
    assert attempts["count"] == 3


# -----------------------------------------------------------------------------
# control_plane 字段反映 instance_name 配置
# -----------------------------------------------------------------------------


# -----------------------------------------------------------------------------
# D3 §4.1 全部 8 个事件清单完整性 — 白名单全开时全能入队
# -----------------------------------------------------------------------------


def test_all_d3_events_pass_when_whitelisted() -> None:
    """D3 §4.1 列出的 8 个事件 (字面冻结清单) 在白名单全开时都能 emit 入队."""
    d3_events = [
        "node.offline",
        "node.online",
        "task.failed",
        "task.lost",
        "review.escalated",
        "review.expired",
        "storage.quota_exceeded",
        "admin.login_failed",
    ]
    settings = _make_settings(webhook_events=d3_events)
    emitter = WebhookEmitter(settings)
    for event in d3_events:
        emitter.emit(event, {"test": True})
    assert emitter._queue.qsize() == len(d3_events)


@pytest.mark.asyncio
async def test_control_plane_field_reflects_instance_name() -> None:
    received = {}

    def handler(request: httpx.Request) -> httpx.Response:
        received["body"] = request.content
        return httpx.Response(200)

    transport = httpx.MockTransport(handler)
    settings = _make_settings(instance_name="gpufleet-prod-shanghai")
    async with httpx.AsyncClient(transport=transport) as client:
        emitter = WebhookEmitter(settings, client=client)
        emitter.start()
        try:
            emitter.emit("task.failed", {"task_id": "x"})
            await asyncio.sleep(0.05)
            await emitter.drain(max_wait_sec=2)
        finally:
            await emitter.aclose()

    envelope = json.loads(received["body"])
    assert envelope["control_plane"] == "gpufleet-prod-shanghai"

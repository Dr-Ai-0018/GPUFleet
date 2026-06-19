"""Webhook 投递: 关键事件异步 POST 到外部接收方 (D3 任务 C).

设计来源: docs/D3_Observability_Design.md §4

设计要点:
- 异步内存队列 + 后台 worker, 不阻塞主流程 (任务/节点正常运转)
- 失败指数退避 3 次 (1s/2s/4s) 后丢弃 + 落日志
- HMAC SHA256 签名 (X-Signature: sha256=<hex>)
- payload 不含密钥 / token / signing key 等敏感数据 (由调用方约束)

非范围 (第二版做):
- 持久化失败事件到 webhook_failed_events 表
- 跨实例去重
- 接收方 SLA 指标
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any

import httpx

from app import metrics as gm
from app.config import Settings
from app.logging_config import get_logger


logger = get_logger(__name__)


_QUEUE_CAPACITY = 1000
_RETRY_DELAYS_SEC: tuple[float, ...] = (1.0, 2.0, 4.0)


# ---------------------------------------------------------------------------
# Module-level 全局入口: 供 service / background 直接 import emit_event 调用,
# 避免每个函数都改签名传 emitter.
# ---------------------------------------------------------------------------

_global_emitter: "WebhookEmitter | None" = None


def set_global_emitter(emitter: "WebhookEmitter | None") -> None:
    """lifespan 启动时调 set_global_emitter(emitter), 关停时 set_global_emitter(None)."""
    global _global_emitter
    _global_emitter = emitter


def emit_event(event: str, payload: dict, *, severity: str = "info") -> None:
    """业务代码同步调用入口. 全局 emitter 为 None 时静默 (测试默认场景)."""
    if _global_emitter is not None:
        _global_emitter.emit(event, payload, severity=severity)


def _sign(secret: str, body: bytes) -> str:
    """X-Signature header value: 'sha256=<hex>'."""
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


class WebhookEmitter:
    """异步事件发送器. lifespan 启动后台 worker, 业务代码调 emit() 不阻塞.

    用法:
        emitter = WebhookEmitter(settings)
        emitter.start()
        emitter.emit("task.failed", {"task_id": "..."}, severity="warning")
        await emitter.aclose()  # 关停时 flush 队列 + 取消 worker
    """

    def __init__(self, settings: Settings, *, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._enabled = bool(settings.webhook_url)
        self._allowed_events = set(settings.webhook_events or ())
        # 注: capacity=1000, 满了 put_nowait 会抛 QueueFull; emit 自己捕获并丢最旧
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_QUEUE_CAPACITY)
        self._worker_task: asyncio.Task[None] | None = None
        self._client = client  # 测试时可注入 mock client
        self._owns_client = client is None

    def emit(self, event: str, payload: dict[str, Any], *, severity: str = "info") -> None:
        """业务代码入口. 同步调用, 立即返回, 不阻塞.

        - webhook_url 空时静默 (不入队)
        - event 不在白名单时静默
        - 队列满时丢最旧, 不报错 (避免主流程被告警风暴拖垮)
        """
        if not self._enabled:
            return
        if event not in self._allowed_events:
            return

        envelope = {
            "event": event,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "severity": severity,
            "payload": payload,
            "control_plane": self._settings.instance_name,
        }

        try:
            self._queue.put_nowait(envelope)
            gm.WEBHOOK_QUEUE_DEPTH.set(self._queue.qsize())
        except asyncio.QueueFull:
            # 容量满 -> 丢最旧, 让新事件进
            try:
                self._queue.get_nowait()
                self._queue.task_done()
            except asyncio.QueueEmpty:
                pass
            try:
                self._queue.put_nowait(envelope)
                gm.WEBHOOK_SEND_TOTAL.labels(event=event, result="dropped").inc()
                gm.WEBHOOK_QUEUE_DEPTH.set(self._queue.qsize())
            except asyncio.QueueFull:
                gm.WEBHOOK_SEND_TOTAL.labels(event=event, result="dropped").inc()
                gm.WEBHOOK_QUEUE_DEPTH.set(self._queue.qsize())
                logger.warning("webhook_queue_drop_on_overflow", webhook_event=event)

    def start(self) -> None:
        """启动后台 worker. lifespan 中调用."""
        if not self._enabled or self._worker_task is not None:
            return
        if not self._settings.webhook_url.lower().startswith("https://"):
            logger.warning(
                "webhook_url_not_https",
                url=self._settings.webhook_url,
                note="HTTP transport leaks payloads in transit. Use https:// in production.",
            )
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._settings.webhook_timeout_sec)
        self._worker_task = asyncio.create_task(self._run_worker(), name="gpufleet-webhook-worker")

    async def aclose(self) -> None:
        """关停: 取消 worker, 关 HTTP client. lifespan 退出时调用.

        drain 超时后给 in-flight deliver 一段额外 grace 再 cancel — 防慢接收方
        + shutdown 场景下当次投递被 cancel 砍掉静默丢事件 (W4). grace 长度跟
        webhook_timeout_sec 对齐, 不引入持久化 spool 路径.
        """
        if self._worker_task is not None:
            drained = await self.drain(max_wait_sec=5.0)
            if not drained:
                # drain 超时 → 给当前 in-flight 一次完整 deliver timeout 的机会
                grace_sec = float(self._settings.webhook_timeout_sec)
                logger.warning(
                    "webhook_drain_extended_grace",
                    queue_depth=self._queue.qsize(),
                    grace_sec=grace_sec,
                )
                try:
                    await asyncio.wait_for(self._queue.join(), timeout=grace_sec)
                except asyncio.TimeoutError:
                    logger.warning(
                        "webhook_drain_grace_timeout_dropping_inflight",
                        queue_depth=self._queue.qsize(),
                    )
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def drain(self, max_wait_sec: float = 5.0) -> bool:
        """等队列发完, 最多等 max_wait_sec 秒. 返回 True = 排空, False = 超时."""
        try:
            await asyncio.wait_for(self._queue.join(), timeout=max_wait_sec)
            return True
        except asyncio.TimeoutError:
            logger.warning("webhook_drain_timeout", queue_depth=self._queue.qsize(), timeout_sec=max_wait_sec)
            return False

    # -- 内部 --

    async def _run_worker(self) -> None:
        assert self._client is not None
        while True:
            envelope = await self._queue.get()
            try:
                await self._deliver(envelope)
            except Exception:
                logger.exception("webhook_worker_unexpected_error", webhook_event=envelope.get("event"))
            finally:
                self._queue.task_done()
                gm.WEBHOOK_QUEUE_DEPTH.set(self._queue.qsize())

    async def _deliver(self, envelope: dict[str, Any]) -> None:
        assert self._client is not None
        body = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self._settings.webhook_secret:
            headers["X-Signature"] = _sign(self._settings.webhook_secret, body)

        last_error: Exception | None = None
        # 第一次直接发, 失败按 _RETRY_DELAYS_SEC 退避重试
        attempts: tuple[float, ...] = (0.0, *_RETRY_DELAYS_SEC)
        for attempt_idx, delay in enumerate(attempts):
            if delay > 0:
                await asyncio.sleep(delay)
            try:
                with gm.WEBHOOK_SEND_DURATION_SECONDS.time():
                    response = await self._client.post(
                        self._settings.webhook_url,
                        content=body,
                        headers=headers,
                    )
                if 200 <= response.status_code < 300:
                    gm.WEBHOOK_SEND_TOTAL.labels(event=str(envelope.get("event")), result="ok").inc()
                    return  # 投递成功
                last_error = RuntimeError(f"HTTP {response.status_code}: {response.text[:200]}")
            except httpx.HTTPError as exc:
                last_error = exc

            logger.warning(
                "webhook_delivery_attempt_failed",
                webhook_event=envelope.get("event"),
                attempt=attempt_idx + 1,
                error=str(last_error)[:300],
            )

        gm.WEBHOOK_SEND_TOTAL.labels(event=str(envelope.get("event")), result="fail").inc()
        logger.error(
            "webhook_delivery_dropped_after_retries",
            webhook_event=envelope.get("event"),
            total_attempts=len(attempts),
            last_error=str(last_error)[:300] if last_error else None,
        )

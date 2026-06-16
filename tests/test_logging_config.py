"""结构化日志接入验收 (D3 任务 B).

设计来源: docs/D3_Observability_Design.md §3
"""

from __future__ import annotations

import json
import logging

import pytest
import structlog
from fastapi.testclient import TestClient

from app.logging_config import (
    bind_request_context,
    clear_request_context,
    configure_logging,
    get_logger,
)


# -----------------------------------------------------------------------------
# json 模式: stdout 一行一 JSON, 含必需字段
# -----------------------------------------------------------------------------


def test_json_mode_emits_parseable_json_with_required_fields(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("json", level=logging.INFO)
    log = get_logger("test.json")
    log.info("user_login_succeeded", user_id=42, ip="127.0.0.1")

    captured = capsys.readouterr()
    # 应至少有一行可解析为 JSON
    lines = [line for line in captured.out.strip().splitlines() if line.strip().startswith("{")]
    assert lines, f"expected JSON lines in stdout, got: {captured.out!r}"

    parsed = json.loads(lines[-1])
    # 必需字段 (D3 §3.2)
    assert parsed["event"] == "user_login_succeeded"
    assert parsed["level"] == "info"
    assert "timestamp" in parsed
    # 业务扩展字段
    assert parsed["user_id"] == 42
    assert parsed["ip"] == "127.0.0.1"


def test_json_mode_serializes_exception_info(capsys: pytest.CaptureFixture[str]) -> None:
    """logger.exception() 应携带 exc_info, 渲染到 JSON 输出."""
    configure_logging("json", level=logging.INFO)
    log = get_logger("test.exc")

    try:
        raise ValueError("boom for test")
    except ValueError:
        log.exception("operation_failed", op="test")

    captured = capsys.readouterr()
    lines = [line for line in captured.out.strip().splitlines() if line.strip().startswith("{")]
    parsed = json.loads(lines[-1])
    assert parsed["event"] == "operation_failed"
    assert parsed["level"] == "error"
    # structlog format_exc_info 把 traceback 渲染到 exception 字段
    assert "exception" in parsed
    assert "ValueError" in parsed["exception"]
    assert "boom for test" in parsed["exception"]


# -----------------------------------------------------------------------------
# console 模式: 可读输出 (不要求 JSON)
# -----------------------------------------------------------------------------


def test_console_mode_outputs_readable_text(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("console", level=logging.INFO)
    log = get_logger("test.console")
    log.info("event_one", task_id="abc-123")

    captured = capsys.readouterr()
    # console 模式不是 JSON, 但应能在输出中看到 event 名和字段
    assert "event_one" in captured.out
    assert "abc-123" in captured.out


# -----------------------------------------------------------------------------
# contextvar (request_id 等) 自动注入
# -----------------------------------------------------------------------------


def test_bound_contextvar_appears_in_subsequent_logs(capsys: pytest.CaptureFixture[str]) -> None:
    """bind_request_context(request_id=...) 后所有 log 都自动带 request_id 字段."""
    configure_logging("json", level=logging.INFO)
    log = get_logger("test.ctx")

    try:
        bind_request_context(request_id="req-xyz-789", node_id="node-A")
        log.info("first_call")
        log.info("second_call", extra_field="hi")
    finally:
        clear_request_context()

    captured = capsys.readouterr()
    lines = [json.loads(line) for line in captured.out.strip().splitlines() if line.strip().startswith("{")]
    relevant = [line for line in lines if line.get("event") in ("first_call", "second_call")]
    assert len(relevant) == 2
    for line in relevant:
        assert line["request_id"] == "req-xyz-789"
        assert line["node_id"] == "node-A"


def test_clear_request_context_removes_bound_vars(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("json", level=logging.INFO)
    log = get_logger("test.clear")

    bind_request_context(request_id="req-1")
    log.info("with_ctx")
    clear_request_context()
    log.info("without_ctx")

    captured = capsys.readouterr()
    lines = [json.loads(line) for line in captured.out.strip().splitlines() if line.strip().startswith("{")]
    with_ctx = next(line for line in lines if line["event"] == "with_ctx")
    without_ctx = next(line for line in lines if line["event"] == "without_ctx")
    assert with_ctx["request_id"] == "req-1"
    assert "request_id" not in without_ctx


# -----------------------------------------------------------------------------
# HTTP 请求自动注入 request_id 到响应头
# -----------------------------------------------------------------------------


def test_http_request_gets_x_request_id_header(client: TestClient) -> None:
    """每个请求经过 _bind_request_id middleware 后, 响应应含 X-Request-Id."""
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert "x-request-id" in {k.lower() for k in resp.headers.keys()}
    request_id = resp.headers.get("x-request-id") or resp.headers.get("X-Request-Id")
    assert request_id is not None
    assert len(request_id) >= 8  # UUID hex 至少 8 字符


def test_http_respects_inbound_x_request_id_header(client: TestClient) -> None:
    """客户端传 X-Request-Id 时应被沿用 (便于跨服务串日志), 而不是覆盖成新 UUID."""
    resp = client.get("/healthz", headers={"X-Request-Id": "client-provided-id-12345"})
    assert resp.headers["X-Request-Id"] == "client-provided-id-12345"


# -----------------------------------------------------------------------------
# stdlib logging 也走 structlog 渲染 (现有 logger.info 不强行改也能用)
# -----------------------------------------------------------------------------


def test_stdlib_logger_routed_through_structlog_formatter(capsys: pytest.CaptureFixture[str]) -> None:
    """logging.getLogger().info('legacy %s', x) 应被 structlog ProcessorFormatter 渲染."""
    configure_logging("json", level=logging.INFO)

    stdlib_logger = logging.getLogger("test.stdlib")
    stdlib_logger.info("legacy message")

    captured = capsys.readouterr()
    lines = [line for line in captured.out.strip().splitlines() if line.strip().startswith("{")]
    assert lines, "stdlib logger should emit through structlog JSON formatter"
    parsed = json.loads(lines[-1])
    # ProcessorFormatter 把 stdlib msg 放在 event 字段
    assert parsed["event"] == "legacy message"
    assert parsed["level"] == "info"

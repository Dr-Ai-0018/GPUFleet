"""结构化日志配置 (D3 任务 B).

设计来源: docs/D3_Observability_Design.md §3

关键策略:
- structlog 与 stdlib logging 共存. 现有 logger.info("...") 不强行改, 通过 ProcessorFormatter 接 structlog 渲染.
- 生产: GPUFLEET_LOG_FORMAT=json -> 每行一个 JSON 对象, stdout, 给 fluent-bit / promtail / loki 抓.
- 开发: 未设或 console -> 彩色可读文本.
- request_id 通过 contextvar 注入, HTTP middleware 绑定.

字段约定 (D3 §3.2):
- timestamp (ISO8601 UTC, structlog 自动)
- level (info/warning/error/debug, structlog 自动)
- event (事件名, 调用方传入)
- logger (模块名, structlog 自动)
- 场景扩展: task_id / node_id / request_id (HTTP 请求场景) / exc_info (异常)
"""

from __future__ import annotations

import logging
import sys
from typing import Any, Literal

import structlog
from structlog.contextvars import merge_contextvars


LogFormat = Literal["json", "console"]


def _common_processors() -> list[Any]:
    """共享 processor 链: 加时间戳/level 名/logger 名, 合并 contextvar (含 request_id)."""
    return [
        merge_contextvars,
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.stdlib.add_logger_name,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]


def configure_logging(log_format: LogFormat = "console", level: int = logging.INFO) -> None:
    """配置 structlog + stdlib logging 共存的统一格式.

    幂等: 多次调用 (例如 lifespan + 测试 fixture) 安全, 后调覆盖前调.
    """
    shared_processors = _common_processors()

    if log_format == "json":
        # 生产: stdout 每行一个 JSON 对象
        renderer: Any = structlog.processors.JSONRenderer()
    else:
        # 开发: 彩色可读, 时间戳缩短
        renderer = structlog.dev.ConsoleRenderer(colors=False)  # colors=False 避免在非 TTY 环境留 ANSI 序列

    # structlog 端: 自家 logger 的 processor 链
    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # stdlib logging 端: 通过 ProcessorFormatter 共享同一 renderer, 让 logger.info("...") 也走结构化输出
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
        foreign_pre_chain=shared_processors,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    # 清除老 handler 避免重复输出
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # 静音过吵的第三方
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """业务代码取 logger 的入口. 等价于 structlog.get_logger(name)."""
    return structlog.get_logger(name)


def bind_request_context(**kwargs: Any) -> None:
    """绑定 contextvar (例如 request_id), 后续同 task / asyncio context 内所有 log 自动含这些字段."""
    structlog.contextvars.bind_contextvars(**kwargs)


def clear_request_context() -> None:
    """清空当前 contextvar (例如 HTTP middleware 请求结束)."""
    structlog.contextvars.clear_contextvars()

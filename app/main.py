from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.responses import RedirectResponse
from prometheus_client import make_asgi_app
from starlette.types import ASGIApp, Receive, Scope, Send

from app import metrics as gm
from app.background import lost_task_scanner
from app.config import get_settings
from app.db import Database, utc_now_iso
from app.errors import install_error_handlers
from app.routers import admin_alerts, admin_auth, admin_dashboard, admin_nodes, admin_observability, admin_tasks, node_api
from app.security import hash_password


def _bootstrap_admin(db: Database) -> None:
    settings = get_settings()
    now_iso = utc_now_iso()
    with db.connect() as conn:
        existing = conn.execute("SELECT 1 FROM admins LIMIT 1").fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO admins (username, password_hash, is_active, created_at, updated_at)
                VALUES (?, ?, 1, ?, ?)
                """,
                (
                    settings.default_admin_username,
                    hash_password(settings.default_admin_password),
                    now_iso,
                    now_iso,
                ),
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # 结构化日志: 必须在 init_schema / bootstrap 之前配, 这样后续 logger.* 都走 structlog renderer
    from app.logging_config import configure_logging
    configure_logging(settings.log_format)

    db = Database(settings.database_path)
    db.init_schema()
    _bootstrap_admin(db)

    # Webhook 投递: 异步后台 worker, webhook_url 空时静默 (start 内自己判断)
    from app.webhook import WebhookEmitter, set_global_emitter
    webhook_emitter = WebhookEmitter(settings)
    webhook_emitter.start()
    set_global_emitter(webhook_emitter)  # 让 service / background 通过 emit_event() 调用

    app.state.settings = settings
    app.state.db = db
    app.state.webhook_emitter = webhook_emitter
    # 节点指纹手动刷新通道: in-memory pending set. 管理员 POST /refresh-fingerprint -> 加入 set;
    # 下次该节点心跳时 response.refresh_fingerprint=True 并从 set 移除. 服务端重启时丢失 pending,
    # 操作幂等可重试, 单实例够用 (多实例时换 redis/db).
    app.state.pending_fingerprint_refresh = set()

    scanner_task = asyncio.create_task(lost_task_scanner(db))
    try:
        yield
    finally:
        scanner_task.cancel()
        try:
            await scanner_task
        except asyncio.CancelledError:
            pass
        set_global_emitter(None)
        await webhook_emitter.aclose()


app = FastAPI(title="GPUFleet Control Plane", version="0.1.0", lifespan=lifespan)
app.state.limiter = admin_auth.limiter
install_error_handlers(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Node-Id",
        "X-Timestamp",
        "X-Nonce",
        "X-Signature",
    ],
)

@app.middleware("http")
async def _bind_request_id(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """每个请求注入 UUID4 request_id 到 structlog contextvar, 后续日志自动带这个字段.

    request_id 也回写到响应头 X-Request-Id, 便于客户端排查 / 日志关联.
    """
    import uuid
    from app.logging_config import bind_request_context, clear_request_context, get_logger

    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    bind_request_context(request_id=request_id)
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        get_logger("app.http").info(
            "http_request_completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        return response
    finally:
        clear_request_context()


@app.middleware("http")
async def _prometheus_http_metrics(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """采集 gpufleet_http_* 指标. 用 path template (route.path) 避免 path cardinality 爆炸."""
    method = request.method
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception:
        # 异常发生时也要计入指标 (status=500), 然后让异常继续往上 propagate 给 exception handler
        elapsed = time.perf_counter() - started_at
        path_template = _path_template_or_raw(request)
        gm.HTTP_REQUESTS_TOTAL.labels(method=method, path_template=path_template, status="500").inc()
        gm.HTTP_REQUEST_DURATION_SECONDS.labels(method=method, path_template=path_template).observe(elapsed)
        raise

    elapsed = time.perf_counter() - started_at
    path_template = _path_template_or_raw(request)
    gm.HTTP_REQUESTS_TOTAL.labels(method=method, path_template=path_template, status=str(status_code)).inc()
    gm.HTTP_REQUEST_DURATION_SECONDS.labels(method=method, path_template=path_template).observe(elapsed)
    return response


def _path_template_or_raw(request: Request) -> str:
    """优先返回 FastAPI route 的 path template (如 /api/v1/admin/nodes/{node_id}).

    未命中路由 (404) / 静态文件 时, 把 path 收敛成"模糊桶"避免 cardinality 爆炸:
    - /metrics / /healthz / /readyz 用原 path
    - /console/* 用 /console/*
    - 其他未知路径用 <unknown>
    """
    route = request.scope.get("route")
    if route is not None and getattr(route, "path", None):
        return route.path
    path = request.url.path
    if path in ("/", "/metrics", "/healthz", "/readyz"):
        return path
    if path.startswith("/console"):
        return "/console/*"
    return "<unknown>"


app.include_router(admin_auth.router)
app.include_router(admin_dashboard.router)
app.include_router(admin_nodes.router)
app.include_router(admin_observability.router)
app.include_router(admin_tasks.router)
app.include_router(admin_alerts.router)
app.include_router(node_api.router)


_LOCALHOST_HOSTS = {"127.0.0.1", "::1", "localhost"}


class MetricsAuthMiddleware:
    """独立保护 /metrics: 配 token 走 Bearer, 未配 token 仅允许 localhost."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        settings = get_settings()
        token = settings.metrics_token.get_secret_value() if settings.metrics_token else ""
        headers = {key.decode("latin1").lower(): value.decode("latin1") for key, value in scope.get("headers", [])}
        if token:
            auth_header = headers.get("authorization", "")
            if not auth_header.startswith("Bearer ") or auth_header[7:] != token:
                await PlainTextResponse("unauthorized", status_code=401)(scope, receive, send)
                return
        else:
            client = scope.get("client")
            client_host = client[0] if client else ""
            if client_host not in _LOCALHOST_HOSTS:
                await PlainTextResponse("forbidden", status_code=403)(scope, receive, send)
                return

        await self.app(scope, receive, send)


app.mount("/metrics", MetricsAuthMiddleware(make_asgi_app()))


@app.get("/")
def root():
    if (get_settings().frontend_dist_path / "index.html").exists():
        return RedirectResponse(url="/console/")
    return {
        "name": "GPUFleet Control Plane",
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> dict[str, str]:
    """Readiness probe: verifies database is reachable and schema is initialized."""
    settings = get_settings()
    db = Database(settings.database_path)
    try:
        with db.connect() as conn:
            conn.execute("SELECT 1 FROM admins LIMIT 1")
    except Exception as exc:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "detail": str(exc)},
        )
    return {"status": "ready"}


@app.get("/console")
@app.get("/console/")
@app.get("/console/{path:path}")
def console_index(path: str = ""):
    frontend_dist = get_settings().frontend_dist_path
    target = frontend_dist / path if path else frontend_dist / "index.html"
    if path and target.exists() and target.is_file():
        return FileResponse(target)

    index_path = frontend_dist / "index.html"
    if not index_path.exists():
        return {
            "status": "frontend_not_built",
            "message": "Build the React frontend to enable /console",
        }
    return FileResponse(index_path)

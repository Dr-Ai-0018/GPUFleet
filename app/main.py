from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.responses import RedirectResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app import metrics as gm
from app.background import lost_task_scanner
from app.config import get_settings
from app.db import Database, utc_now_iso
from app.errors import ApiError, install_error_handlers
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
    db = Database(settings.database_path)
    db.init_schema()
    _bootstrap_admin(db)
    app.state.settings = settings
    app.state.db = db
    scanner_task = asyncio.create_task(lost_task_scanner(db))
    yield
    scanner_task.cancel()
    try:
        await scanner_task
    except asyncio.CancelledError:
        pass


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
    """优先返回 FastAPI route 的 path template (如 /api/admin/nodes/{node_id}).

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


_LOCALHOST_HOSTS = {"127.0.0.1", "::1", "localhost"}


@app.get("/metrics", include_in_schema=False)
def metrics(request: Request) -> Response:
    """Prometheus scrape 端点.

    保护策略:
    - 配 GPUFLEET_METRICS_TOKEN: 请求必须带 Authorization: Bearer <token>, 否则 401.
    - 未配 token: 仅允许 localhost (127.0.0.1 / ::1) 直接抓取, 远程一律 401.
    """
    settings = get_settings()
    token = settings.metrics_token
    if token:
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer ") or auth_header[7:] != token:
            raise ApiError(
                code="ERR_AUTH_INVALID_TOKEN",
                message="Invalid metrics token",
                status_code=401,
            )
    else:
        client_host = request.client.host if request.client else ""
        if client_host not in _LOCALHOST_HOSTS:
            raise ApiError(
                code="ERR_AUTH_INVALID_TOKEN",
                message="Metrics endpoint requires GPUFLEET_METRICS_TOKEN when accessed remotely",
                status_code=401,
                details={"client_host": client_host},
            )
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


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

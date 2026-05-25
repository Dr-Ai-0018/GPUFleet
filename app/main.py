from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import RedirectResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.background import lost_task_scanner
from app.config import get_settings
from app.db import Database, utc_now_iso
from app.routers import admin_auth, admin_dashboard, admin_nodes, admin_observability, admin_tasks, node_api
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
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
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

app.include_router(admin_auth.router)
app.include_router(admin_dashboard.router)
app.include_router(admin_nodes.router)
app.include_router(admin_observability.router)
app.include_router(admin_tasks.router)
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

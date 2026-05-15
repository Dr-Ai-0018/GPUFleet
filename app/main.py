from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings
from app.db import Database, utc_now_iso
from app.routers import admin_auth, admin_nodes, admin_tasks, node_api
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
    yield


app = FastAPI(title="GPUFleet Control Plane", version="0.1.0", lifespan=lifespan)

app.include_router(admin_auth.router)
app.include_router(admin_nodes.router)
app.include_router(admin_tasks.router)
app.include_router(node_api.router)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "name": "GPUFleet Control Plane",
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from slowapi.util import get_ipaddr

from app.config import Settings
from app.db import Database
from app.deps import get_db, get_settings_dep
from app.routers.admin_auth import limiter
from app.schemas import HeartbeatResponse
from app.services import node_runtime_service

router = APIRouter(prefix="/api/node", tags=["node"])


def _node_rate_limit_key(request: Request) -> str:
    node_id = request.headers.get("X-Node-Id")
    if node_id:
        return node_id
    return f"unknown:{get_ipaddr(request)}"


@router.post("/heartbeat", response_model=HeartbeatResponse)
@limiter.limit("60/minute", key_func=_node_rate_limit_key)
async def heartbeat(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> HeartbeatResponse:
    return await node_runtime_service.heartbeat(request, db, settings)


@router.post("/task-events")
async def task_events(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, object]:
    return await node_runtime_service.task_events(request, db, settings)


@router.post("/task-log-chunk")
async def task_log_chunk(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, object]:
    return await node_runtime_service.task_log_chunk(request, db, settings)


@router.post("/task-result")
async def task_result(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, object]:
    return await node_runtime_service.task_result(request, db, settings)


@router.post("/artifact-upload")
async def artifact_upload(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, object]:
    return await node_runtime_service.artifact_upload(request, db, settings)

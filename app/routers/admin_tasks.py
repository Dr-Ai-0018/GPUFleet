from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.config import Settings
from app.db import Database
from app.deps import get_current_admin, get_db, get_settings_dep
from app.routers.admin_auth import limiter
from app.schemas import (
    AdminTaskArtifactView,
    AdminTaskCreateRequest,
    AdminTaskDetail,
    AdminTaskListPage,
    AdminTaskLogView,
    ReviewApproveRequest,
    ReviewEscalateRequest,
    ReviewRejectRequest,
)
from app.services import admin_tasks_service

router = APIRouter(prefix="/api/v1/admin/tasks", tags=["admin-tasks"])


@router.post("", response_model=AdminTaskDetail, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def create_task(
    payload: AdminTaskCreateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> AdminTaskDetail:
    return await admin_tasks_service.create_task(payload, request, admin, db, settings)


@router.get("", response_model=AdminTaskListPage)
def list_tasks(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    cursor: str | None = None,
    node_id: str | None = None,
    status: str | None = None,
    type: str | None = None,  # noqa: A002 - API query parameter name
    since: str | None = None,
    until: str | None = None,
) -> AdminTaskListPage:
    return admin_tasks_service.list_tasks(
        db,
        limit=limit,
        cursor=cursor,
        node_id=node_id,
        status=status,
        task_type=type,
        since=since,
        until=until,
    )


@router.get("/{task_id}", response_model=AdminTaskDetail)
def get_task(
    task_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AdminTaskDetail:
    return admin_tasks_service.get_task(task_id, db)


@router.post("/{task_id}/cancel", response_model=AdminTaskDetail)
@limiter.limit("30/minute")
def cancel_task(
    task_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AdminTaskDetail:
    return admin_tasks_service.cancel_task(task_id, request, admin, db)


@router.post("/{task_id}/review/escalate", response_model=AdminTaskDetail)
@limiter.limit("30/minute")
def escalate_review(
    task_id: str,
    payload: ReviewEscalateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AdminTaskDetail:
    return admin_tasks_service.escalate_review(task_id, payload, request, admin, db)


@router.post("/{task_id}/review/approve", response_model=AdminTaskDetail)
@limiter.limit("30/minute")
def approve_review(
    task_id: str,
    payload: ReviewApproveRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AdminTaskDetail:
    return admin_tasks_service.approve_review(task_id, payload, request, admin, db)


@router.post("/{task_id}/review/reject", response_model=AdminTaskDetail)
@limiter.limit("30/minute")
def reject_review(
    task_id: str,
    payload: ReviewRejectRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AdminTaskDetail:
    return admin_tasks_service.reject_review(task_id, payload, request, admin, db)


@router.get("/{task_id}/logs", response_model=list[AdminTaskLogView])
def get_task_logs(
    task_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> list[AdminTaskLogView]:
    return admin_tasks_service.get_task_logs(task_id, db)


@router.get("/{task_id}/artifacts", response_model=list[AdminTaskArtifactView])
def get_task_artifacts(
    task_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> list[AdminTaskArtifactView]:
    return admin_tasks_service.get_task_artifacts(task_id, db)

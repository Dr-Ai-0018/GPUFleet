from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.db import Database
from app.deps import get_current_admin, get_db
from app.routers.admin_auth import limiter
from app.schemas import (
    NodeCreateResponse,
    NodeCreateRequest,
    NodeResponse,
    NodeStatusHistoryResponse,
    NodeStatusPreview,
    NodeUpdateRequest,
)
from app.services import admin_nodes_service

router = APIRouter(prefix="/api/admin/nodes", tags=["admin-nodes"])


@router.get("", response_model=list[NodeResponse])
def list_nodes(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[NodeResponse]:
    return admin_nodes_service.list_nodes(db, limit=limit, offset=offset)


@router.post("", response_model=NodeCreateResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_node(
    payload: NodeCreateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeCreateResponse:
    return admin_nodes_service.create_node(payload, request, admin, db)


@router.get("/{node_id}", response_model=NodeResponse)
def get_node(
    node_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    return admin_nodes_service.get_node(node_id, db)


@router.patch("/{node_id}", response_model=NodeResponse)
@limiter.limit("30/minute")
def update_node(
    node_id: str,
    payload: NodeUpdateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    return admin_nodes_service.update_node(node_id, payload, request, admin, db)


@router.post("/{node_id}/disable", response_model=NodeResponse)
@limiter.limit("30/minute")
def disable_node(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    return admin_nodes_service.set_node_enabled(node_id, False, request, admin, db)


@router.post("/{node_id}/enable", response_model=NodeResponse)
@limiter.limit("30/minute")
def enable_node(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    return admin_nodes_service.set_node_enabled(node_id, True, request, admin, db)


@router.post("/{node_id}/reset-secret", response_model=NodeCreateResponse)
@limiter.limit("30/minute")
def reset_node_secret(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeCreateResponse:
    return admin_nodes_service.reset_node_secret(node_id, request, admin, db)


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_node(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> None:
    admin_nodes_service.delete_node(node_id, request, admin, db)


@router.get("/{node_id}/status/latest", response_model=NodeStatusPreview)
def get_latest_status(
    node_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeStatusPreview:
    return admin_nodes_service.get_latest_status(node_id, db)


@router.get("/{node_id}/status/history", response_model=NodeStatusHistoryResponse)
def get_status_history(
    node_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 60,
) -> NodeStatusHistoryResponse:
    return admin_nodes_service.get_status_history(node_id, db, limit=limit)

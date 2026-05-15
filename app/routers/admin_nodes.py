from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.db import Database, dumps_json, utc_now_iso
from app.deps import get_current_admin, get_db
from app.schemas import (
    NodeCreateRequest,
    NodeCreateResponse,
    NodeResponse,
    NodeStatusPreview,
    NodeUpdateRequest,
)
from app.security import derive_node_signing_key, generate_node_secret

router = APIRouter(prefix="/api/admin/nodes", tags=["admin-nodes"])


def _row_to_node_response(row: object) -> NodeResponse:
    return NodeResponse(
        node_id=row["node_id"],
        display_name=row["display_name"],
        node_type=row["node_type"],
        os_type=row["os_type"],
        hostname=row["hostname"],
        heartbeat_interval_sec=row["heartbeat_interval_sec"],
        allowed_workdirs=json.loads(row["allowed_workdirs_json"]),
        tags=json.loads(row["tags_json"]),
        is_enabled=bool(row["is_enabled"]),
        last_seen_at=row["last_seen_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=list[NodeResponse])
def list_nodes(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> list[NodeResponse]:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM nodes ORDER BY created_at ASC").fetchall()
    return [_row_to_node_response(row) for row in rows]


@router.post("", response_model=NodeCreateResponse, status_code=status.HTTP_201_CREATED)
def create_node(
    payload: NodeCreateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeCreateResponse:
    now_iso = utc_now_iso()
    node_secret = generate_node_secret()
    derived_key = derive_node_signing_key(node_secret)

    with db.connect() as conn:
        existing = conn.execute(
            "SELECT 1 FROM nodes WHERE node_id = ?",
            (payload.node_id,),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="node_id already exists",
            )

        conn.execute(
            """
            INSERT INTO nodes (
                node_id, display_name, node_signing_key, node_type, os_type, hostname,
                heartbeat_interval_sec, allowed_workdirs_json, tags_json,
                is_enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                payload.node_id,
                payload.display_name,
                derived_key,
                payload.node_type,
                payload.os_type,
                payload.hostname,
                payload.heartbeat_interval_sec,
                dumps_json(payload.allowed_workdirs),
                dumps_json(payload.tags),
                now_iso,
                now_iso,
            ),
        )
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "create_node",
                "node",
                payload.node_id,
                request.client.host if request.client else None,
                dumps_json(payload.model_dump()),
                now_iso,
            ),
        )
        row = conn.execute(
            "SELECT * FROM nodes WHERE node_id = ?",
            (payload.node_id,),
        ).fetchone()

    base = _row_to_node_response(row)
    return NodeCreateResponse(**base.model_dump(), node_secret=node_secret)


@router.get("/{node_id}", response_model=NodeResponse)
def get_node(
    node_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    return _row_to_node_response(row)


@router.patch("/{node_id}", response_model=NodeResponse)
def update_node(
    node_id: str,
    payload: NodeUpdateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No changes provided")

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

        updated = dict(row)
        if "allowed_workdirs" in changes:
            updated["allowed_workdirs_json"] = dumps_json(changes.pop("allowed_workdirs"))
        if "tags" in changes:
            updated["tags_json"] = dumps_json(changes.pop("tags"))
        if "is_enabled" in changes:
            updated["is_enabled"] = int(changes.pop("is_enabled"))
        updated.update(changes)
        updated["updated_at"] = utc_now_iso()

        conn.execute(
            """
            UPDATE nodes
            SET display_name = ?, os_type = ?, hostname = ?, heartbeat_interval_sec = ?,
                allowed_workdirs_json = ?, tags_json = ?, is_enabled = ?, updated_at = ?
            WHERE node_id = ?
            """,
            (
                updated["display_name"],
                updated["os_type"],
                updated["hostname"],
                updated["heartbeat_interval_sec"],
                updated["allowed_workdirs_json"],
                updated["tags_json"],
                updated["is_enabled"],
                updated["updated_at"],
                node_id,
            ),
        )
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "update_node",
                "node",
                node_id,
                request.client.host if request.client else None,
                dumps_json(payload.model_dump(exclude_none=True)),
                updated["updated_at"],
            ),
        )
        saved = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()

    return _row_to_node_response(saved)


@router.post("/{node_id}/disable", response_model=NodeResponse)
def disable_node(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    return _set_node_enabled(node_id, False, request, admin, db)


@router.post("/{node_id}/enable", response_model=NodeResponse)
def enable_node(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    return _set_node_enabled(node_id, True, request, admin, db)


def _set_node_enabled(
    node_id: str,
    enabled: bool,
    request: Request,
    admin: object,
    db: Database,
) -> NodeResponse:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
        conn.execute(
            "UPDATE nodes SET is_enabled = ?, updated_at = ? WHERE node_id = ?",
            (1 if enabled else 0, now_iso, node_id),
        )
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "enable_node" if enabled else "disable_node",
                "node",
                node_id,
                request.client.host if request.client else None,
                dumps_json({"enabled": enabled}),
                now_iso,
            ),
        )
        saved = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
    return _row_to_node_response(saved)


@router.get("/{node_id}/status/latest", response_model=NodeStatusPreview)
def get_latest_status(
    node_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeStatusPreview:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT reported_at, cpu_json, memory_json, disk_json, gpu_json, python_env_json, task_runtime_json
            FROM node_status_snapshots
            WHERE node_id = ?
            ORDER BY reported_at DESC, id DESC
            LIMIT 1
            """,
            (node_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No status snapshot found")

    return NodeStatusPreview(
        reported_at=row["reported_at"],
        cpu=json.loads(row["cpu_json"]),
        memory=json.loads(row["memory_json"]),
        disks=json.loads(row["disk_json"]),
        gpus=json.loads(row["gpu_json"]),
        python_env=json.loads(row["python_env_json"]),
        task_runtime=json.loads(row["task_runtime_json"]),
    )

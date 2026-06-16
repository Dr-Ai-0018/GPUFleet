from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.db import Database
from app.deps import get_current_admin, get_db
from app.schemas import AuditEventView, SecurityWarningView

router = APIRouter(prefix="/api/v1/admin", tags=["admin-observability"])


@router.get("/audit-events", response_model=list[AuditEventView])
def list_audit_events(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[AuditEventView]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT id, actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at
            FROM audit_events
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        AuditEventView(
            id=row["id"],
            actor_type=row["actor_type"],
            actor_id=row["actor_id"],
            action=row["action"],
            target_type=row["target_type"],
            target_id=row["target_id"],
            request_ip=row["request_ip"],
            detail=json.loads(row["detail_json"]) if row["detail_json"] else {},
            created_at=row["created_at"],
        )
        for row in rows
    ]


@router.get("/security-warnings", response_model=list[SecurityWarningView])
def list_security_warnings(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[SecurityWarningView]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT id, source_type, source_id, warning_type, command_excerpt, detail_json, created_at
            FROM security_warnings
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        SecurityWarningView(
            id=row["id"],
            source_type=row["source_type"],
            source_id=row["source_id"],
            warning_type=row["warning_type"],
            command_excerpt=row["command_excerpt"],
            detail=json.loads(row["detail_json"]) if row["detail_json"] else {},
            created_at=row["created_at"],
        )
        for row in rows
    ]

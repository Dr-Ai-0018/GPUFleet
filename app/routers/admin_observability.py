from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.db import Database
from app.deps import get_current_admin, get_db
from app.schemas import AuditEventPage, AuditEventView, SecurityWarningPage, SecurityWarningView
from app.services.cursor_pagination import add_cursor_filter, add_time_filters, encode_cursor

router = APIRouter(prefix="/api/v1/admin", tags=["admin-observability"])


def _audit_event_from_row(row: object) -> AuditEventView:
    return AuditEventView(
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


def _security_warning_from_row(row: object) -> SecurityWarningView:
    return SecurityWarningView(
        id=row["id"],
        source_type=row["source_type"],
        source_id=row["source_id"],
        warning_type=row["warning_type"],
        command_excerpt=row["command_excerpt"],
        detail=json.loads(row["detail_json"]) if row["detail_json"] else {},
        created_at=row["created_at"],
    )


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
    return [_audit_event_from_row(row) for row in rows]


@router.get("/audits", response_model=AuditEventPage)
def list_audits_page(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    cursor: str | None = None,
    actor_type: str | None = None,
    action: str | None = None,
    target_type: str | None = None,
    since: str | None = None,
    until: str | None = None,
) -> AuditEventPage:
    sql_parts = [
        "SELECT id, actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at",
        "FROM audit_events",
        "WHERE 1=1",
    ]
    count_parts = ["SELECT COUNT(*) AS count FROM audit_events WHERE 1=1"]
    params: list[object] = []
    count_params: list[object] = []

    def add_filter(condition: str, value: object) -> None:
        sql_parts.append(condition)
        count_parts.append(condition)
        params.append(value)
        count_params.append(value)

    if actor_type:
        add_filter("AND actor_type = ?", actor_type)
    if action:
        add_filter("AND action = ?", action)
    if target_type:
        add_filter("AND target_type = ?", target_type)
    add_time_filters(sql_parts, params, since=since, until=until)
    add_time_filters(count_parts, count_params, since=since, until=until)
    add_cursor_filter(sql_parts, params, cursor)
    sql_parts.append("ORDER BY created_at DESC, id DESC")
    sql_parts.append("LIMIT ?")
    params.append(limit + 1)

    with db.connect() as conn:
        rows = conn.execute("\n".join(sql_parts), params).fetchall()
        total_estimate = conn.execute("\n".join(count_parts), count_params).fetchone()["count"]

    page_rows = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(created_at=last["created_at"], row_id=last["id"])
    return AuditEventPage(
        items=[_audit_event_from_row(row) for row in page_rows],
        next_cursor=next_cursor,
        total_estimate=total_estimate,
    )


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
    return [_security_warning_from_row(row) for row in rows]


@router.get("/warnings", response_model=SecurityWarningPage)
def list_warnings_page(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    cursor: str | None = None,
    warning_type: str | None = None,
    source_type: str | None = None,
    since: str | None = None,
    until: str | None = None,
) -> SecurityWarningPage:
    sql_parts = [
        "SELECT id, source_type, source_id, warning_type, command_excerpt, detail_json, created_at",
        "FROM security_warnings",
        "WHERE 1=1",
    ]
    count_parts = ["SELECT COUNT(*) AS count FROM security_warnings WHERE 1=1"]
    params: list[object] = []
    count_params: list[object] = []

    def add_filter(condition: str, value: object) -> None:
        sql_parts.append(condition)
        count_parts.append(condition)
        params.append(value)
        count_params.append(value)

    if warning_type:
        add_filter("AND warning_type = ?", warning_type)
    if source_type:
        add_filter("AND source_type = ?", source_type)
    add_time_filters(sql_parts, params, since=since, until=until)
    add_time_filters(count_parts, count_params, since=since, until=until)
    add_cursor_filter(sql_parts, params, cursor)
    sql_parts.append("ORDER BY created_at DESC, id DESC")
    sql_parts.append("LIMIT ?")
    params.append(limit + 1)

    with db.connect() as conn:
        rows = conn.execute("\n".join(sql_parts), params).fetchall()
        total_estimate = conn.execute("\n".join(count_parts), count_params).fetchone()["count"]

    page_rows = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(created_at=last["created_at"], row_id=last["id"])
    return SecurityWarningPage(
        items=[_security_warning_from_row(row) for row in page_rows],
        next_cursor=next_cursor,
        total_estimate=total_estimate,
    )

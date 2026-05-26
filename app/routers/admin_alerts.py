from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db import Database, utc_now_iso
from app.deps import get_current_admin, get_db
from app.schemas import AlertMessageView

router = APIRouter(prefix="/api/admin/alerts", tags=["admin-alerts"])


def _row_to_alert(row: object) -> AlertMessageView:
    return AlertMessageView(
        id=row["id"],
        alert_type=row["alert_type"],
        severity=row["severity"],
        title=row["title"],
        summary=row["summary"],
        detail=json.loads(row["detail_json"]) if row["detail_json"] else {},
        target_type=row["target_type"],
        target_id=row["target_id"],
        status=row["status"],
        actioned_by=row["actioned_by"],
        actioned_at=row["actioned_at"],
        expires_at=row["expires_at"],
        created_at=row["created_at"],
    )


@router.get("", response_model=list[AlertMessageView])
def list_alerts(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AlertMessageView]:
    query = """
        SELECT *
        FROM alert_messages
    """
    params: list[object] = []
    if status_filter:
        query += " WHERE status = ?"
        params.append(status_filter)
    query += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with db.connect() as conn:
        rows = conn.execute(query, tuple(params)).fetchall()
    return [_row_to_alert(row) for row in rows]


@router.get("/unread-count")
def unread_count(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> dict[str, int]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS unread_count FROM alert_messages WHERE status = 'unread'"
        ).fetchone()
    return {"unread_count": int(row["unread_count"]) if row else 0}


@router.post("/{alert_id}/read", response_model=AlertMessageView)
def mark_read(
    alert_id: int,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AlertMessageView:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM alert_messages WHERE id = ?", (alert_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Alert not found")
        conn.execute(
            """
            UPDATE alert_messages
            SET status = 'read', actioned_by = ?, actioned_at = ?
            WHERE id = ?
            """,
            (admin["id"], now_iso, alert_id),
        )
        saved = conn.execute("SELECT * FROM alert_messages WHERE id = ?", (alert_id,)).fetchone()
    return _row_to_alert(saved)

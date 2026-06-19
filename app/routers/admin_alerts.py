from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from slowapi.util import get_remote_address

from app.config import get_settings
from app.db import Database, utc_now_iso
from app.deps import get_current_admin, get_db
from app.errors import ApiError
from app.routers.admin_auth import limiter
from app.schemas import AlertMessageView
from app.security import decode_token

router = APIRouter(prefix="/api/v1/admin/alerts", tags=["admin-alerts"])


def _admin_rate_limit_key(request: Request) -> str:
    """按 admin 身份计量, NAT 后多管理员不互饿. 解 Authorization Bearer 拿 sub.

    decode 失败 (无 token / token 过期 / 签名错) 回退到 IP — 仍是合理桶, 不会
    让未鉴权请求绕开限流.
    """
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            payload = decode_token(get_settings(), token, "access")
            sub = payload.get("sub")
            if sub:
                return f"admin:{sub}"
        except Exception:
            pass
    return f"ip:{get_remote_address(request)}"


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
@limiter.limit("30/minute", key_func=_admin_rate_limit_key)
def list_alerts(
    request: Request,
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
@limiter.limit("60/minute", key_func=_admin_rate_limit_key)
def unread_count(
    request: Request,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> dict[str, int]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS unread_count FROM alert_messages WHERE status = 'unread'"
        ).fetchone()
    return {"unread_count": int(row["unread_count"]) if row else 0}


@router.post("/{alert_id}/read", response_model=AlertMessageView)
@limiter.limit("30/minute", key_func=_admin_rate_limit_key)
def mark_read(
    alert_id: int,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AlertMessageView:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM alert_messages WHERE id = ?", (alert_id,)).fetchone()
        if row is None:
            raise ApiError(
                code="ERR_ALERT_NOT_FOUND",
                message="Alert not found",
                status_code=404,
                details={"alert_id": alert_id},
            )
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

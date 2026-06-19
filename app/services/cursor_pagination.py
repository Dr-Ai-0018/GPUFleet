from __future__ import annotations

import base64
import json

from fastapi import status

from app.errors import ApiError


def encode_cursor(*, created_at: str, row_id: int) -> str:
    payload = json.dumps({"created_at": created_at, "id": row_id}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[str, int] | None:
    if not cursor:
        return None
    try:
        padded = cursor + ("=" * (-len(cursor) % 4))
        parsed = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        created_at = parsed["created_at"]
        row_id = parsed["id"]
        if not isinstance(created_at, str) or not isinstance(row_id, int):
            raise ValueError
        return created_at, row_id
    except (KeyError, TypeError, ValueError, UnicodeDecodeError) as exc:
        raise ApiError(
            code="ERR_VALIDATION_INVALID_CURSOR",
            message="Invalid cursor",
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from exc


def add_cursor_filter(sql_parts: list[str], params: list[object], cursor: str | None) -> None:
    decoded = decode_cursor(cursor)
    if decoded is None:
        return
    created_at, row_id = decoded
    sql_parts.append("AND (created_at < ? OR (created_at = ? AND id < ?))")
    params.extend([created_at, created_at, row_id])


def add_time_filters(
    sql_parts: list[str],
    params: list[object],
    *,
    since: str | None,
    until: str | None,
) -> None:
    if since:
        sql_parts.append("AND created_at >= ?")
        params.append(since)
    if until:
        sql_parts.append("AND created_at <= ?")
        params.append(until)


from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.db import Database
from app.errors import ApiError
from app.security import decode_token

bearer_scheme = HTTPBearer(auto_error=True)


def _token_invalidated(token_iat: int | None, tokens_invalidated_at: str | None) -> bool:
    if token_iat is None or not tokens_invalidated_at:
        return False
    invalidated_at = datetime.fromisoformat(tokens_invalidated_at.replace("Z", "+00:00"))
    if invalidated_at.tzinfo is None:
        invalidated_at = invalidated_at.replace(tzinfo=UTC)
    return token_iat <= int(invalidated_at.timestamp())


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_settings_dep() -> Settings:
    return get_settings()


def get_current_admin(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> sqlite3.Row:
    try:
        payload = decode_token(settings, credentials.credentials, "access")
    except Exception as exc:
        raise ApiError(
            code="ERR_AUTH_INVALID_TOKEN",
            message="Invalid access token",
            status_code=status.HTTP_401_UNAUTHORIZED,
        ) from exc

    username = payload.get("sub")
    token_iat = payload.get("iat")
    with db.connect() as conn:
        admin = conn.execute(
            "SELECT * FROM admins WHERE username = ? AND is_active = 1",
            (username,),
        ).fetchone()

    if admin is None:
        raise ApiError(
            code="ERR_AUTH_ADMIN_NOT_FOUND",
            message="Admin account not found",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    if _token_invalidated(token_iat, admin["tokens_invalidated_at"]):
        raise ApiError(
            code="ERR_AUTH_TOKEN_REVOKED",
            message="Access token has been invalidated",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    return admin

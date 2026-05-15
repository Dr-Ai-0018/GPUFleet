from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.db import Database
from app.security import decode_token

bearer_scheme = HTTPBearer(auto_error=True)


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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
        ) from exc

    username = payload.get("sub")
    with db.connect() as conn:
        admin = conn.execute(
            "SELECT * FROM admins WHERE username = ? AND is_active = 1",
            (username,),
        ).fetchone()

    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin account not found",
        )

    return admin

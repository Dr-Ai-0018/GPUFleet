from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings
from app.db import Database, utc_now_iso
from app.deps import get_current_admin, get_db, get_settings_dep
from app.schemas import AdminProfile, LoginRequest, RefreshRequest, TokenPair
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)

router = APIRouter(prefix="/api/admin", tags=["admin-auth"])


@router.post("/login", response_model=TokenPair)
def login(
    payload: LoginRequest,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> TokenPair:
    with db.connect() as conn:
        admin = conn.execute(
            "SELECT * FROM admins WHERE username = ? AND is_active = 1",
            (payload.username,),
        ).fetchone()

        if admin is None or not verify_password(payload.password, admin["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        now_iso = utc_now_iso()
        conn.execute(
            "UPDATE admins SET last_login_at = ?, updated_at = ? WHERE id = ?",
            (now_iso, now_iso, admin["id"]),
        )

    return TokenPair(
        access_token=create_access_token(settings, payload.username),
        refresh_token=create_refresh_token(settings, payload.username),
    )


@router.post("/refresh", response_model=TokenPair)
def refresh(
    payload: RefreshRequest,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> TokenPair:
    try:
        token_payload = decode_token(settings, payload.refresh_token, "refresh")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        ) from exc

    username = token_payload.get("sub")
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

    return TokenPair(
        access_token=create_access_token(settings, username),
        refresh_token=create_refresh_token(settings, username),
    )


@router.get("/me", response_model=AdminProfile)
def me(admin: Annotated[object, Depends(get_current_admin)]) -> AdminProfile:
    return AdminProfile(
        id=admin["id"],
        username=admin["username"],
        is_active=bool(admin["is_active"]),
        last_login_at=admin["last_login_at"],
    )

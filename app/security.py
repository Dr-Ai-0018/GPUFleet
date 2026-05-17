from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from passlib.context import CryptContext

from app.config import Settings

password_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_context.verify(password, password_hash)


def create_token(
    settings: Settings,
    subject: str,
    token_type: str,
    expires_minutes: int,
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(settings: Settings, token: str, expected_type: str) -> dict[str, Any]:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise ValueError("Invalid token type")
    return payload


def create_access_token(settings: Settings, subject: str) -> str:
    return create_token(settings, subject, "access", settings.access_token_expire_minutes)


def create_refresh_token(settings: Settings, subject: str) -> str:
    return create_token(settings, subject, "refresh", settings.refresh_token_expire_minutes)


def generate_node_secret() -> str:
    return secrets.token_urlsafe(32)


def derive_node_signing_key(node_secret: str) -> str:
    return hashlib.sha256(node_secret.encode("utf-8")).hexdigest()


def hash_request_body(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def sign_node_request(
    derived_signing_key: str,
    node_id: str,
    timestamp: str,
    nonce: str,
    body_hash: str,
) -> str:
    message = "\n".join([node_id, timestamp, nonce, body_hash]).encode("utf-8")
    return hmac.new(
        derived_signing_key.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()


def verify_node_request_signature(
    derived_signing_key: str,
    node_id: str,
    timestamp: str,
    nonce: str,
    body_hash: str,
    signature: str,
) -> bool:
    expected = sign_node_request(derived_signing_key, node_id, timestamp, nonce, body_hash)
    return hmac.compare_digest(expected, signature)


def build_signed_headers_for_test(node_id: str, node_secret: str, body: bytes) -> dict[str, str]:
    """Build signed request headers for testing. Mirrors node_agent's build_headers."""
    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
    nonce = secrets.token_hex(12)
    signing_key = derive_node_signing_key(node_secret)
    body_hash = hash_request_body(body)
    signature = sign_node_request(signing_key, node_id, timestamp, nonce, body_hash)
    return {
        "Content-Type": "application/json",
        "X-Node-Id": node_id,
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
        "X-Signature": signature,
    }

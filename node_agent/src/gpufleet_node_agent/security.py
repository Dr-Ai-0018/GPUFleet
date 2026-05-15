from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime


def derive_signing_key(node_secret: str) -> str:
    return hashlib.sha256(node_secret.encode("utf-8")).hexdigest()


def hash_request_body(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def build_headers(node_id: str, node_secret: str, body: bytes) -> dict[str, str]:
    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
    nonce = secrets.token_hex(12)
    signing_key = derive_signing_key(node_secret)
    message = "\n".join([node_id, timestamp, nonce, hash_request_body(body)]).encode("utf-8")
    signature = hmac.new(signing_key.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/json",
        "X-Node-Id": node_id,
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
        "X-Signature": signature,
    }

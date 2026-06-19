from __future__ import annotations

import base64
import ctypes
import hashlib
import hmac
import json
import os
import secrets
from ctypes import wintypes
from datetime import UTC, datetime
from pathlib import Path


_SECRET_STORE_CONTEXT = b"gpufleet-agent-node-secret-v1"
_FALLBACK_KDF_ROUNDS = 200_000


def derive_signing_key(node_secret: str) -> str:
    return hashlib.sha256(node_secret.encode("utf-8")).hexdigest()


def hash_request_body(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _keystream_bytes(key: bytes, nonce: bytes, size: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < size:
        block = hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest()
        output.extend(block)
        counter += 1
    return bytes(output[:size])


def _fallback_encrypt(secret: str, passphrase: str) -> dict[str, str | int]:
    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, _FALLBACK_KDF_ROUNDS, dklen=32)
    plaintext = secret.encode("utf-8")
    keystream = _keystream_bytes(key, nonce, len(plaintext))
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, keystream, strict=False))
    tag = hmac.new(key, _SECRET_STORE_CONTEXT + nonce + ciphertext, hashlib.sha256).digest()
    return {
        "scheme": "passphrase-v1",
        "iterations": _FALLBACK_KDF_ROUNDS,
        "salt_b64": base64.b64encode(salt).decode("ascii"),
        "nonce_b64": base64.b64encode(nonce).decode("ascii"),
        "ciphertext_b64": base64.b64encode(ciphertext).decode("ascii"),
        "tag_b64": base64.b64encode(tag).decode("ascii"),
    }


def _fallback_decrypt(payload: dict[str, object], passphrase: str) -> str:
    salt = base64.b64decode(str(payload["salt_b64"]))
    nonce = base64.b64decode(str(payload["nonce_b64"]))
    ciphertext = base64.b64decode(str(payload["ciphertext_b64"]))
    expected_tag = base64.b64decode(str(payload["tag_b64"]))
    iterations = int(payload.get("iterations", _FALLBACK_KDF_ROUNDS))
    key = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, iterations, dklen=32)
    actual_tag = hmac.new(key, _SECRET_STORE_CONTEXT + nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(actual_tag, expected_tag):
        raise ValueError("Encrypted node secret integrity check failed")
    keystream = _keystream_bytes(key, nonce, len(ciphertext))
    plaintext = bytes(a ^ b for a, b in zip(ciphertext, keystream, strict=False))
    return plaintext.decode("utf-8")


if os.name == "nt":
    CRYPTPROTECT_UI_FORBIDDEN = 0x1

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


    _crypt32 = ctypes.WinDLL("Crypt32.dll")
    _kernel32 = ctypes.WinDLL("Kernel32.dll")

    _CryptProtectData = _crypt32.CryptProtectData
    _CryptProtectData.argtypes = [
        ctypes.POINTER(DATA_BLOB),
        wintypes.LPCWSTR,
        ctypes.POINTER(DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(DATA_BLOB),
    ]
    _CryptProtectData.restype = wintypes.BOOL

    _CryptUnprotectData = _crypt32.CryptUnprotectData
    _CryptUnprotectData.argtypes = [
        ctypes.POINTER(DATA_BLOB),
        ctypes.POINTER(wintypes.LPWSTR),
        ctypes.POINTER(DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(DATA_BLOB),
    ]
    _CryptUnprotectData.restype = wintypes.BOOL

    _LocalFree = _kernel32.LocalFree
    _LocalFree.argtypes = [ctypes.c_void_p]
    _LocalFree.restype = ctypes.c_void_p


def _blob_from_bytes(data: bytes) -> DATA_BLOB:
    buffer = ctypes.create_string_buffer(data)
    return DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))


def _dpapi_encrypt(secret: str) -> dict[str, str]:
    if os.name != "nt":
        raise ValueError("DPAPI is only available on Windows")
    plaintext = secret.encode("utf-8")
    input_blob = _blob_from_bytes(plaintext)
    entropy_blob = _blob_from_bytes(_SECRET_STORE_CONTEXT)
    output_blob = DATA_BLOB()
    if not _CryptProtectData(
        ctypes.byref(input_blob),
        "GPUFleet Node Secret",
        ctypes.byref(entropy_blob),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output_blob),
    ):
        raise ctypes.WinError()
    try:
        raw = ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        _LocalFree(output_blob.pbData)
    return {
        "scheme": "dpapi-v1",
        "ciphertext_b64": base64.b64encode(raw).decode("ascii"),
    }


def _dpapi_decrypt(payload: dict[str, object]) -> str:
    if os.name != "nt":
        raise ValueError("DPAPI is only available on Windows")
    ciphertext = base64.b64decode(str(payload["ciphertext_b64"]))
    input_blob = _blob_from_bytes(ciphertext)
    entropy_blob = _blob_from_bytes(_SECRET_STORE_CONTEXT)
    output_blob = DATA_BLOB()
    if not _CryptUnprotectData(
        ctypes.byref(input_blob),
        None,
        ctypes.byref(entropy_blob),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output_blob),
    ):
        raise ctypes.WinError()
    try:
        raw = ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        _LocalFree(output_blob.pbData)
    return raw.decode("utf-8")


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


def _write_secret_payload(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def seal_node_secret(settings: object, node_secret: str) -> Path:
    path = settings.secret_store_path()
    passphrase = str(getattr(settings, "node_secret_passphrase", "") or "")
    if os.name == "nt":
        payload = _dpapi_encrypt(node_secret)
    else:
        if not passphrase:
            raise ValueError("Non-Windows secret sealing requires GPUFLEET_AGENT_NODE_SECRET_PASSPHRASE")
        payload = _fallback_encrypt(node_secret, passphrase)
    _write_secret_payload(path, payload)
    return path


def load_encrypted_node_secret(settings: object) -> str:
    path = settings.secret_store_path()
    payload = json.loads(path.read_text(encoding="utf-8"))
    scheme = str(payload.get("scheme", "")).strip()
    if scheme == "dpapi-v1":
        return _dpapi_decrypt(payload)
    if scheme == "passphrase-v1":
        passphrase = str(getattr(settings, "node_secret_passphrase", "") or "")
        if not passphrase:
            raise ValueError("Encrypted node secret requires GPUFLEET_AGENT_NODE_SECRET_PASSPHRASE")
        return _fallback_decrypt(payload, passphrase)
    raise ValueError(f"Unsupported node secret protection scheme: {scheme}")


def load_or_seal_node_secret(settings: object) -> str:
    plaintext = str(getattr(settings, "node_secret", "") or "").strip()
    path = settings.secret_store_path()

    if path.exists():
        stored = load_encrypted_node_secret(settings)
        if plaintext and plaintext != stored:
            seal_node_secret(settings, plaintext)
            return plaintext
        return stored

    if not plaintext or plaintext == "replace-me":
        raise ValueError(
            "Node secret not configured. Set GPUFLEET_AGENT_NODE_SECRET once to bootstrap, "
            "or provide an existing encrypted secret file."
        )
    seal_node_secret(settings, plaintext)
    return plaintext

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest

from app.errors import ApiError, install_error_handlers


ERROR_CASES: list[tuple[str, int]] = [
    ("ERR_AUTH_INVALID_TOKEN", 401),
    ("ERR_AUTH_ADMIN_NOT_FOUND", 401),
    ("ERR_AUTH_TOKEN_REVOKED", 401),
    ("ERR_AUTH_REFRESH_REVOKED", 401),
    ("ERR_AUTH_INVALID_CREDENTIALS", 401),
    ("ERR_AUTH_INVALID_REFRESH_TOKEN", 401),
    ("ERR_AUTH_INVALID_TIMESTAMP", 401),
    ("ERR_AUTH_MISSING_HEADERS", 401),
    ("ERR_AUTH_TIMESTAMP_SKEW", 401),
    ("ERR_AUTH_NODE_NOT_FOUND_OR_DISABLED", 401),
    ("ERR_AUTH_SIGNING_KEY_UNAVAILABLE", 401),
    ("ERR_AUTH_INVALID_SIGNATURE", 401),
    ("ERR_AUTH_NONCE_DUPLICATE", 409),
    ("ERR_AUTH_TIMESTAMP_REPLAY", 409),
    ("ERR_NODE_NOT_FOUND", 404),
    ("ERR_NODE_DUPLICATE_ID", 409),
    ("ERR_NODE_NO_CHANGES", 400),
    ("ERR_NODE_STATUS_NOT_FOUND", 404),
    ("ERR_NODE_DISABLED", 400),
    ("ERR_TASK_NOT_FOUND", 404),
    ("ERR_TASK_DUPLICATE_ID", 409),
    ("ERR_TASK_TARGET_NODE_NOT_FOUND", 404),
    ("ERR_TASK_INVALID_TARGET_FOR_TYPE", 400),
    ("ERR_TASK_WORKDIR_NOT_ALLOWED", 400),
    ("ERR_TASK_TYPE_FORBIDDEN_ON_NODE", 403),
    ("ERR_TASK_INVALID_STATE_TRANSITION", 400),
    ("ERR_REVIEW_NOT_PENDING", 400),
    ("ERR_REVIEW_COOLDOWN_NOT_REACHED", 429),
    ("ERR_LOG_OFFSET_MUST_START_ZERO", 409),
    ("ERR_LOG_OFFSET_GAP", 409),
    ("ERR_LOG_STREAM_TRUNCATED", 507),
    ("ERR_STORAGE_QUOTA_EXCEEDED", 507),
    ("ERR_ARTIFACT_INVALID_NAME", 400),
    ("ERR_ARTIFACT_INVALID_CONTENT_LENGTH", 400),
    ("ERR_ARTIFACT_INVALID_BASE64", 400),
    ("ERR_PAYLOAD_TOO_LARGE", 413),
    ("ERR_ALERT_NOT_FOUND", 404),
    ("ERR_VALIDATION_INVALID_PAYLOAD", 422),
    ("ERR_RATE_LIMITED", 429),
]


def _error_test_client() -> TestClient:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/errors/{code}")
    def raise_api_error(code: str):
        status_code = dict(ERROR_CASES)[code]
        raise ApiError(
            code=code,
            message=f"Message for {code}",
            status_code=status_code,
            details={"code": code},
        )

    @app.get("/legacy-http")
    def raise_legacy_http():
        raise HTTPException(status_code=418, detail="Legacy detail")

    @app.post("/validation")
    def validation_route(payload: dict[str, int]):
        return payload

    return TestClient(app)


@pytest.mark.parametrize(("code", "status_code"), ERROR_CASES)
def test_api_error_shape_for_frozen_codes(code: str, status_code: int) -> None:
    client = _error_test_client()
    resp = client.get(f"/errors/{code}")

    assert resp.status_code == status_code
    body = resp.json()
    assert body == {
        "code": code,
        "message": f"Message for {code}",
        "details": {"code": code},
    }
    assert "detail" not in body


def test_validation_errors_use_structured_shape(client: TestClient) -> None:
    resp = client.post("/api/admin/login", json={"username": "admin"})

    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "ERR_VALIDATION_FAILED"
    assert body["message"] == "Validation failed"
    assert isinstance(body["details"]["errors"], list)
    assert "detail" not in body


def test_legacy_http_exceptions_fallback_to_structured_shape() -> None:
    client = _error_test_client()
    resp = client.get("/legacy-http")

    assert resp.status_code == 418
    assert resp.json() == {
        "code": "ERR_HTTP_418",
        "message": "Legacy detail",
        "details": {},
    }

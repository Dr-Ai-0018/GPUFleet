from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        status_code: int,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = dict(details or {})


def error_payload(code: str, message: str, details: Mapping[str, Any] | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": dict(details or {}),
    }


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(exc.code, exc.message, exc.details),
    )


async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(f"ERR_HTTP_{exc.status_code}", detail or f"HTTP {exc.status_code}"),
        headers=exc.headers,
    )


async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=error_payload(
            "ERR_VALIDATION_FAILED",
            "Validation failed",
            {"errors": exc.errors()},
        ),
    )


async def rate_limit_error_handler(_: Request, exc: RateLimitExceeded) -> JSONResponse:
    retry_after = 60
    headers = getattr(exc, "headers", None)
    if isinstance(headers, Mapping):
        raw_retry_after = headers.get("Retry-After")
        if raw_retry_after is not None:
            try:
                retry_after = int(raw_retry_after)
            except (TypeError, ValueError):
                retry_after = 60
    return JSONResponse(
        status_code=429,
        content=error_payload(
            "ERR_RATE_LIMITED",
            "Rate limit exceeded",
            {"retry_after_sec": retry_after},
        ),
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(RateLimitExceeded, rate_limit_error_handler)

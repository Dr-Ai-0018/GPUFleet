from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.review import LLMReviewer, ReviewContext


def _settings() -> Settings:
    return Settings(
        jwt_secret="test-secret-at-least-32-bytes-long!!",
        default_admin_password="test-admin-pass",
        review_llm_api_key="test-key",
    )


class _MockStreamResponse:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _MockAsyncClient:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, method: str, url: str, headers: dict[str, str], json: dict[str, object]):
        return _MockStreamResponse(self._lines)


@pytest.mark.anyio
async def test_review_stream_parses_json(monkeypatch) -> None:
    payload = json.dumps(
        {
            "choices": [
                {
                    "delta": {
                        "content": "{\"decision\":\"approve\",\"risk_score\":0.2,"
                        "\"risk_factors\":[],\"reasoning\":\"ok\"}"
                    }
                }
            ]
        }
    )
    lines = [f"data: {payload}", "data: [DONE]"]
    monkeypatch.setattr("app.review.httpx.AsyncClient", lambda timeout: _MockAsyncClient(lines))

    reviewer = LLMReviewer(_settings())
    result = await reviewer.review(
        ReviewContext(task_type="shell", node_id="node-1", node_type="physical", payload={"command": "echo ok"})
    )

    assert result.decision == "approve"
    assert result.risk_score == 0.2
    assert result.reasoning == "ok"


@pytest.mark.anyio
async def test_review_timeout_returns_uncertain(monkeypatch) -> None:
    class _TimeoutClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, method: str, url: str, headers: dict[str, str], json: dict[str, object]):
            raise httpx.TimeoutException("timeout")

    monkeypatch.setattr("app.review.httpx.AsyncClient", lambda timeout: _TimeoutClient())

    reviewer = LLMReviewer(_settings())
    result = await reviewer.review(
        ReviewContext(task_type="shell", node_id="node-1", node_type="physical", payload={"command": "echo ok"})
    )

    assert result.decision == "uncertain"
    assert result.risk_score == 0.5

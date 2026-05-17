from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
import types

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

try:
    import requests  # type: ignore[import-not-found]
except ModuleNotFoundError:
    requests = types.ModuleType("requests")

    class ConnectionError(Exception):
        pass

    class Timeout(Exception):
        pass

    class HTTPError(Exception):
        def __init__(self, response=None) -> None:
            super().__init__("http error")
            self.response = response

    requests.exceptions = types.SimpleNamespace(  # type: ignore[attr-defined]
        ConnectionError=ConnectionError,
        Timeout=Timeout,
        HTTPError=HTTPError,
    )
    requests.post = lambda *args, **kwargs: None  # type: ignore[attr-defined]
    sys.modules["requests"] = requests

from gpufleet_node_agent import api_client  # noqa: E402


class _Response:
    def __init__(self, status_code: int, payload: dict[str, object] | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {"ok": True}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(response=self)

    def json(self) -> dict[str, object]:
        return self._payload


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        control_plane_url="https://example.com",
        node_id="node-1",
        node_secret="secret",
        tls_skip_verify=False,
    )


def test_post_signed_json_retries_transient_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    def fake_post(*args: object, **kwargs: object) -> _Response:
        calls["count"] += 1
        if calls["count"] < 3:
            raise requests.exceptions.ConnectionError("temporary")
        return _Response(200, {"ok": True})

    monkeypatch.setattr(api_client.requests, "post", fake_post)
    monkeypatch.setattr(api_client.time, "sleep", lambda _: None)

    result = api_client.post_signed_json(_settings(), "/api/node/task-events", {"x": 1})
    assert result == {"ok": True}
    assert calls["count"] == 3


def test_post_signed_json_does_not_retry_permanent_http_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    def fake_post(*args: object, **kwargs: object) -> _Response:
        calls["count"] += 1
        return _Response(400)

    monkeypatch.setattr(api_client.requests, "post", fake_post)

    with pytest.raises(requests.exceptions.HTTPError):
        api_client.post_signed_json(_settings(), "/api/node/task-events", {"x": 1})
    assert calls["count"] == 1

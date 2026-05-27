from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
import types

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

if "requests" not in sys.modules:
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
    requests.post = lambda **kwargs: None  # type: ignore[attr-defined]
    sys.modules["requests"] = requests

from gpufleet_node_agent import task_runner  # noqa: E402


def _settings(tmp_path: Path) -> SimpleNamespace:
    state_dir = tmp_path / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(state_dir=state_dir)


def test_incremental_log_ack_only_advances_after_success(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    stdout_path = tmp_path / "stdout.log"
    stdout_path.write_text("abcdef", encoding="utf-8")
    state = {
        "task_id": "tsk_1",
        "stdout_path": str(stdout_path),
        "stderr_path": "",
        "stdout_offset": 0,
        "stderr_offset": 0,
    }

    def failing_send(*args, **kwargs):
        raise RuntimeError("temporary upload failure")

    monkeypatch.setattr(task_runner, "send_task_log_chunk", failing_send)

    with pytest.raises(RuntimeError):
        task_runner._upload_incremental_logs(settings, state.copy(), final=False)

    assert task_runner._acked_log_offset(settings, "tsk_1", "stdout") == 0

    sent_payloads: list[dict[str, object]] = []

    def success_send(agent_settings, payload):
        sent_payloads.append(payload)
        return {"ok": True}

    monkeypatch.setattr(task_runner, "send_task_log_chunk", success_send)
    updated = task_runner._upload_incremental_logs(settings, state.copy(), final=False)

    assert sent_payloads[0]["offset_start"] == 0
    assert sent_payloads[0]["text"] == "abcdef"
    assert task_runner._acked_log_offset(settings, "tsk_1", "stdout") == 6
    assert updated["stdout_offset"] == 6


def test_recover_orphaned_task_replays_only_unacked_tail(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    stdout_path = tmp_path / "stdout.log"
    stdout_path.write_text("abcdef", encoding="utf-8")
    state = {
        "task_id": "tsk_2",
        "type": "shell",
        "stdout_path": str(stdout_path),
        "stderr_path": "",
        "stdout_offset": 0,
        "stderr_offset": 0,
        "run_dir": str(tmp_path),
        "workdir": str(tmp_path),
        "command": ["echo", "hi"],
        "started_at": "2026-01-01T00:00:00+00:00",
    }
    task_runner.save_json(settings.state_dir / "current_task.json", state)
    task_runner._store_acked_log_offset(settings, "tsk_2", "stdout", 3)
    task_runner._store_acked_log_offset(settings, "tsk_2", "stderr", 0)

    sent_chunks: list[dict[str, object]] = []

    monkeypatch.setattr(task_runner, "_pid_exists", lambda pid: False)
    monkeypatch.setattr(task_runner, "send_task_result", lambda *args, **kwargs: {"ok": True})
    monkeypatch.setattr(task_runner, "send_artifact_file", lambda *args, **kwargs: {"ok": True})

    def capture_send(agent_settings, payload):
        sent_chunks.append(payload)
        return {"ok": True}

    monkeypatch.setattr(task_runner, "send_task_log_chunk", capture_send)

    result = task_runner.recover_orphaned_task(settings)

    assert result is not None
    stdout_payloads = [item for item in sent_chunks if item["stream"] == "stdout"]
    assert stdout_payloads[0]["offset_start"] == 3
    assert stdout_payloads[0]["text"] == "def"

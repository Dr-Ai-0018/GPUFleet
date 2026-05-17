from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
import types

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

from gpufleet_node_agent import cli  # noqa: E402


def test_finalize_shutdown_task_marks_state_and_recovers(monkeypatch) -> None:
    saved: dict[str, object] = {}
    recovered: dict[str, object] = {}

    monkeypatch.setattr(cli, "load_json", lambda path, default: {"task_id": "tsk_1", "pid": 321})

    def fake_save(path, data) -> None:
        saved.update(data)

    def fake_recover(settings):
        recovered["called"] = True
        return {"task_id": "tsk_1", "final_status": "cancelled"}

    monkeypatch.setattr(cli, "save_json", fake_save)
    monkeypatch.setattr(cli, "recover_orphaned_task", fake_recover)

    cli.ACTIVE_PROCESSES.clear()
    cli.ACTIVE_PROCESSES["tsk_1"] = object()  # type: ignore[assignment]

    cli._finalize_shutdown_task(SimpleNamespace(state_dir=Path(".")))

    assert saved["cancel_requested"] is True
    assert saved["shutdown_requested"] is True
    assert recovered["called"] is True
    assert cli.ACTIVE_PROCESSES == {}

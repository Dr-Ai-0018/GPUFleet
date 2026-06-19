from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.runner import executor


class _TimeoutProcess:
    pid = 4242
    returncode = None

    def __init__(self) -> None:
        self.communicate_calls = 0

    def communicate(self, timeout: int | None = None) -> tuple[str, str]:
        self.communicate_calls += 1
        if self.communicate_calls == 1:
            raise subprocess.TimeoutExpired(cmd=["fake"], timeout=timeout)
        return "", "timed out"


def test_execute_task_timeout_terminates_process_tree(tmp_path: Path, monkeypatch) -> None:
    settings = AgentSettings(
        agent_root=tmp_path,
        runs_dir=tmp_path / "runs",
        state_dir=tmp_path / "state",
        logs_dir=tmp_path / "logs",
        artifacts_dir=tmp_path / "artifacts",
        repos_dir=tmp_path / "repos",
        modal_profiles_dir=tmp_path / "modal",
    )
    settings.ensure_dirs()
    process = _TimeoutProcess()
    terminated: list[tuple[int, int]] = []
    results: list[dict[str, object]] = []

    monkeypatch.setattr(executor, "execute_native_task", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(executor, "_compat_attr", lambda _name, default: default)
    monkeypatch.setattr(executor.subprocess, "Popen", lambda *_args, **_kwargs: process)
    monkeypatch.setattr(executor, "terminate_process_tree", lambda proc, grace: terminated.append((proc.pid, grace)))
    monkeypatch.setattr(executor, "_default_send_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(executor, "_default_send_task_result", lambda _settings, payload: results.append(payload))
    monkeypatch.setattr(executor, "_default_send_artifact_file", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(executor, "upload_log_text", lambda *_args, **_kwargs: None)

    outcome = executor.execute_task(
        settings,
        {
            "task_id": "timeout-task",
            "type": "health_check",
            "payload": {},
            "timeout_sec": 1,
            "kill_grace_sec": 7,
        },
    )

    assert terminated == [(4242, 7)]
    assert outcome["final_status"] == "timeout"
    assert results[-1]["final_status"] == "timeout"

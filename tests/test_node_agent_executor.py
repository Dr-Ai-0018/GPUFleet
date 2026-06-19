from __future__ import annotations

import subprocess
import sys
import textwrap
import time
from pathlib import Path

import psutil
import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE_AGENT_SRC = ROOT / "node_agent" / "src"
if str(NODE_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(NODE_AGENT_SRC))

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.runner import executor


def _wait_for_pid_file(path: Path, timeout_sec: float = 5.0) -> dict[str, int]:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if path.exists():
            values: dict[str, int] = {}
            for line in path.read_text(encoding="utf-8").splitlines():
                key, raw_value = line.split("=", 1)
                values[key] = int(raw_value)
            if {"parent", "child"} <= values.keys():
                return values
        time.sleep(0.05)
    raise AssertionError(f"PID file was not populated: {path}")


def _wait_until_gone(*pids: int, timeout_sec: float = 5.0) -> None:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if all(not psutil.pid_exists(pid) for pid in pids):
            return
        time.sleep(0.05)
    alive = [pid for pid in pids if psutil.pid_exists(pid)]
    raise AssertionError(f"Processes still alive after timeout: {alive}")


def _write_process_tree_script(tmp_path: Path) -> tuple[Path, Path]:
    pid_file = tmp_path / "pids.txt"
    script = tmp_path / "spawn_tree.py"
    script.write_text(
        textwrap.dedent(
            f"""
            import subprocess
            import sys
            import time
            from pathlib import Path

            child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
            Path({str(pid_file)!r}).write_text(f"parent={{__import__('os').getpid()}}\\nchild={{child.pid}}\\n", encoding="utf-8")
            try:
                time.sleep(60)
            finally:
                child.poll()
            """
        ),
        encoding="utf-8",
    )
    return script, pid_file


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


@pytest.mark.skipif(sys.platform == "win32", reason="Linux/macOS process group path only")
def test_terminate_process_tree_kills_linux_process_group(tmp_path: Path) -> None:
    script, pid_file = _write_process_tree_script(tmp_path)
    process = subprocess.Popen(
        [sys.executable, str(script)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        **executor.process_group_popen_kwargs(),
    )
    pids = _wait_for_pid_file(pid_file)

    try:
        executor.terminate_process_tree(process, grace_sec=1)
        _wait_until_gone(pids["parent"], pids["child"], timeout_sec=3.0)
    finally:
        for pid in (pids["parent"], pids["child"]):
            if psutil.pid_exists(pid):
                psutil.Process(pid).kill()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows taskkill tree path only")
def test_terminate_process_tree_kills_windows_process_tree(tmp_path: Path) -> None:
    script, pid_file = _write_process_tree_script(tmp_path)
    process = subprocess.Popen(
        [sys.executable, str(script)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        **executor.process_group_popen_kwargs(),
    )
    pids = _wait_for_pid_file(pid_file)

    try:
        executor.terminate_process_tree(process, grace_sec=1)
        _wait_until_gone(pids["parent"], pids["child"], timeout_sec=5.0)
    finally:
        for pid in (pids["parent"], pids["child"]):
            if psutil.pid_exists(pid):
                psutil.Process(pid).kill()

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import time
from threading import Event

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.heartbeat import send_heartbeat
from gpufleet_node_agent.sampler import SampleRingBuffer, start_sampler
from gpufleet_node_agent.state import load_json, save_json
from gpufleet_node_agent.task_runner import (
    ACTIVE_PROCESSES,
    execute_tasks,
    has_active_task,
    recover_orphaned_task,
    start_tasks_background,
    sync_active_task,
)

logger = logging.getLogger(__name__)

# Shutdown coordination
_shutdown_event = Event()


def _request_shutdown(signum: int, frame: object) -> None:
    """Signal handler that sets the shutdown flag."""
    sig_name = signal.Signals(signum).name if hasattr(signal, "Signals") else str(signum)
    logger.info("Received %s, initiating graceful shutdown...", sig_name)
    _shutdown_event.set()


def _terminate_active_processes(grace_sec: int = 30) -> None:
    """Send termination signal to all active subprocesses and wait."""
    if not ACTIVE_PROCESSES:
        return

    logger.info("Terminating %d active process(es)...", len(ACTIVE_PROCESSES))
    for task_id, proc in list(ACTIVE_PROCESSES.items()):
        try:
            if os.name == "nt":
                proc.terminate()
            else:
                proc.send_signal(signal.SIGTERM)
            logger.info("Sent terminate to task %s (pid %d)", task_id, proc.pid)
        except (OSError, ProcessLookupError):
            pass

    # Wait for processes to exit
    deadline = time.time() + grace_sec
    for task_id, proc in list(ACTIVE_PROCESSES.items()):
        remaining = max(0, deadline - time.time())
        try:
            proc.wait(timeout=remaining)
        except Exception:
            # Force kill if still alive
            try:
                proc.kill()
                logger.warning("Force-killed task %s (pid %d)", task_id, proc.pid)
                proc.wait(timeout=5)
            except (OSError, ProcessLookupError):
                pass


def _install_signal_handlers() -> None:
    """Register signal handlers for graceful shutdown."""
    signal.signal(signal.SIGINT, _request_shutdown)
    signal.signal(signal.SIGTERM, _request_shutdown)
    if os.name == "nt" and hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _request_shutdown)


def _finalize_shutdown_task(settings: AgentSettings) -> None:
    state_path = settings.state_dir / "current_task.json"
    state = load_json(state_path, {})
    if not state.get("task_id"):
        return

    state["cancel_requested"] = True
    state["shutdown_requested"] = True
    save_json(state_path, state)

    for task_id in list(ACTIVE_PROCESSES):
        ACTIVE_PROCESSES.pop(task_id, None)

    try:
        result = recover_orphaned_task(settings)
        if result:
            logger.info("Finalized task %s during shutdown as %s", result["task_id"], result["final_status"])
    except Exception:
        logger.exception("Failed to finalize current task during shutdown")


def run_once(settings: AgentSettings) -> None:
    result = send_heartbeat(settings)
    try:
        recover_orphaned_task(settings)
    except Exception as exc:
        print(json.dumps({"ok": False, "recovery_error": str(exc)}, ensure_ascii=False))
    if result.get("tasks"):
        execute_tasks(settings, result["tasks"])
    print(json.dumps(result, ensure_ascii=False, indent=2))


def run_loop(settings: AgentSettings) -> None:
    _install_signal_handlers()

    if settings.tls_skip_verify:
        logger.warning("TLS verification is DISABLED (GPUFLEET_AGENT_TLS_SKIP_VERIFY=true). Not recommended for production.")

    # 启动高密采样 ring buffer + 后台线程: 每 sample_interval_sec 跑一次 collect_sample()
    sample_buffer = SampleRingBuffer(capacity=settings.sample_buffer_size)
    start_sampler(sample_buffer, _shutdown_event, settings.sample_interval_sec)

    while not _shutdown_event.is_set():
        try:
            result = send_heartbeat(settings, sample_buffer=sample_buffer)
            try:
                recover_orphaned_task(settings)
            except Exception as exc:
                print(json.dumps({"ok": False, "recovery_error": str(exc)}, ensure_ascii=False))
            controls = result.get("task_controls", [])
            sync_active_task(settings, controls)
            if result.get("tasks") and not has_active_task(settings):
                start_tasks_background(settings, result["tasks"])
            print(json.dumps(result, ensure_ascii=False))
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))

        # Use event wait instead of time.sleep for responsive shutdown
        _shutdown_event.wait(timeout=settings.heartbeat_interval_sec)

    # Graceful shutdown: sampler thread 是 daemon, _shutdown_event 已 set 后自己退出.
    logger.info("Shutting down agent...")
    _terminate_active_processes(grace_sec=30)
    _finalize_shutdown_task(settings)
    logger.info("Agent shutdown complete.")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(description="GPUFleet node agent")
    parser.add_argument("command", choices=["heartbeat-once", "heartbeat-loop"])
    args = parser.parse_args()

    settings = AgentSettings()
    settings.ensure_dirs()
    settings.get_node_secret()

    if args.command == "heartbeat-once":
        run_once(settings)
    else:
        run_loop(settings)


if __name__ == "__main__":
    main()

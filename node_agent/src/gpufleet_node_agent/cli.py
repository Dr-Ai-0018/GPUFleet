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
from gpufleet_node_agent.sampler import Sampler
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

    # 启动时一次性采集完整画像并缓存 (~10-15s, 接受这一次性投资).
    # 此后心跳 payload 顶层 cpu/memory/gpus 等直接从缓存读 (微秒级), 不再每次启 PowerShell.
    from gpufleet_node_agent import fingerprint
    fingerprint.get_cached(settings)
    fingerprint.start_refresh_worker(settings, _shutdown_event)

    # 启动高密采样器: 后台线程每 sample_interval_sec 采一次, 心跳侧 drain ring buffer.
    sampler = Sampler(
        sample_interval_sec=settings.sample_interval_sec,
        sample_buffer_size=settings.sample_buffer_size,
        stop_event=_shutdown_event,
    ).start()

    while not _shutdown_event.is_set():
        try:
            result = send_heartbeat(settings, sample_buffer=sampler)
            # 服务端指示刷新指纹 → 触发后台 refresh worker (异步, 不阻塞本次心跳)
            if result.get("refresh_fingerprint"):
                logger.info("server_requested_fingerprint_refresh")
                fingerprint.mark_dirty()
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
    sampler.shutdown()
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

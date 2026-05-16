from __future__ import annotations

import argparse
import json
import time

from gpufleet_node_agent.config import AgentSettings
from gpufleet_node_agent.heartbeat import send_heartbeat
from gpufleet_node_agent.task_runner import (
    execute_tasks,
    has_active_task,
    recover_orphaned_task,
    start_tasks_background,
    sync_active_task,
)


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
    while True:
        try:
            result = send_heartbeat(settings)
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
        time.sleep(settings.heartbeat_interval_sec)


def main() -> None:
    parser = argparse.ArgumentParser(description="GPUFleet node agent")
    parser.add_argument("command", choices=["heartbeat-once", "heartbeat-loop"])
    args = parser.parse_args()

    settings = AgentSettings()
    settings.ensure_dirs()

    if args.command == "heartbeat-once":
        run_once(settings)
    else:
        run_loop(settings)

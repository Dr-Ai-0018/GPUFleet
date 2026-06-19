from __future__ import annotations

from gpufleet_node_agent.runner.dispatcher import has_active_task, recover_orphaned_task, start_tasks_background, sync_active_task
from gpufleet_node_agent.runner.executor import ACTIVE_PROCESSES, execute_task, execute_tasks


class TaskRunner:
    ACTIVE_PROCESSES = ACTIVE_PROCESSES

    @staticmethod
    def execute_task(*args, **kwargs):
        return execute_task(*args, **kwargs)

    @staticmethod
    def execute_tasks(*args, **kwargs):
        return execute_tasks(*args, **kwargs)

    @staticmethod
    def has_active_task(*args, **kwargs):
        return has_active_task(*args, **kwargs)

    @staticmethod
    def recover_orphaned_task(*args, **kwargs):
        return recover_orphaned_task(*args, **kwargs)

    @staticmethod
    def start_tasks_background(*args, **kwargs):
        return start_tasks_background(*args, **kwargs)

    @staticmethod
    def sync_active_task(*args, **kwargs):
        return sync_active_task(*args, **kwargs)


__all__ = [
    "ACTIVE_PROCESSES",
    "TaskRunner",
    "execute_task",
    "execute_tasks",
    "has_active_task",
    "recover_orphaned_task",
    "start_tasks_background",
    "sync_active_task",
]

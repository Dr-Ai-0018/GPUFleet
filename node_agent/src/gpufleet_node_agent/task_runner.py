from __future__ import annotations

from gpufleet_node_agent.api_client import send_artifact_file, send_task_event, send_task_log_chunk, send_task_result
from gpufleet_node_agent.runner import ACTIVE_PROCESSES, TaskRunner, execute_task, execute_tasks, has_active_task, recover_orphaned_task, start_tasks_background, sync_active_task
from gpufleet_node_agent.runner.artifact import build_result_summary as _build_result_summary
from gpufleet_node_agent.runner.artifact import execute_native_task as _execute_native_task
from gpufleet_node_agent.runner.artifact import now_iso as _now_iso
from gpufleet_node_agent.runner.artifact import payload_value as _payload_value
from gpufleet_node_agent.runner.artifact import prepare_run_dir as _prepare_run_dir
from gpufleet_node_agent.runner.artifact import resolve_safe_path as _resolve_safe_path
from gpufleet_node_agent.runner.artifact import resolve_workdir as _resolve_workdir
from gpufleet_node_agent.runner.artifact import safe_task_name as _safe_task_name
from gpufleet_node_agent.runner.artifact import task_extra_roots as _task_extra_roots
from gpufleet_node_agent.runner.artifact import write_local_logs as _write_local_logs
from gpufleet_node_agent.runner.dispatcher import clear_current_task as _clear_current_task
from gpufleet_node_agent.runner.dispatcher import finalize_background_task as _finalize_background_task
from gpufleet_node_agent.runner.dispatcher import load_current_task as _load_current_task
from gpufleet_node_agent.runner.dispatcher import set_current_task as _set_current_task
from gpufleet_node_agent.runner.dispatcher import start_background_task as _start_background_task
from gpufleet_node_agent.runner.executor import build_command as _build_command
from gpufleet_node_agent.runner.executor import build_env as _build_env
from gpufleet_node_agent.runner.executor import build_modal_command as _build_modal_command
from gpufleet_node_agent.runner.executor import pid_exists as _pid_exists
from gpufleet_node_agent.runner.executor import terminate_process_tree as _terminate_process_tree
from gpufleet_node_agent.runner.log_pump import LOG_CHUNK_SIZE
from gpufleet_node_agent.runner.log_pump import acked_log_offset as _acked_log_offset
from gpufleet_node_agent.runner.log_pump import clear_log_offsets as _clear_log_offsets
from gpufleet_node_agent.runner.log_pump import init_log_offsets as _init_log_offsets
from gpufleet_node_agent.runner.log_pump import load_log_offsets as _load_log_offsets
from gpufleet_node_agent.runner.log_pump import read_text_slice as _read_text_slice
from gpufleet_node_agent.runner.log_pump import save_log_offsets as _save_log_offsets
from gpufleet_node_agent.runner.log_pump import send_log_chunks_with_ack as _send_log_chunks_with_ack
from gpufleet_node_agent.runner.log_pump import store_acked_log_offset as _store_acked_log_offset
from gpufleet_node_agent.runner.log_pump import upload_incremental_logs as _upload_incremental_logs
from gpufleet_node_agent.runner.log_pump import upload_log_text as _upload_log_text
from gpufleet_node_agent.state import load_json, save_json

__all__ = [
    "ACTIVE_PROCESSES",
    "LOG_CHUNK_SIZE",
    "TaskRunner",
    "_acked_log_offset",
    "_build_command",
    "_build_env",
    "_build_modal_command",
    "_build_result_summary",
    "_clear_current_task",
    "_clear_log_offsets",
    "_execute_native_task",
    "_finalize_background_task",
    "_init_log_offsets",
    "_load_current_task",
    "_load_log_offsets",
    "_now_iso",
    "_payload_value",
    "_pid_exists",
    "_prepare_run_dir",
    "_read_text_slice",
    "_resolve_safe_path",
    "_resolve_workdir",
    "_safe_task_name",
    "_save_log_offsets",
    "_send_log_chunks_with_ack",
    "_set_current_task",
    "_start_background_task",
    "_store_acked_log_offset",
    "_task_extra_roots",
    "_terminate_process_tree",
    "_upload_incremental_logs",
    "_upload_log_text",
    "_write_local_logs",
    "execute_task",
    "execute_tasks",
    "has_active_task",
    "load_json",
    "recover_orphaned_task",
    "save_json",
    "send_artifact_file",
    "send_task_event",
    "send_task_log_chunk",
    "send_task_result",
    "start_tasks_background",
    "sync_active_task",
]

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from app.task_utils import ACTIVE_TASK_STATUSES, RESULT_ACCEPTING_TASK_STATUSES, TASK_EVENT_TRANSITIONS, TERMINAL_TASK_STATUSES


@dataclass
class TaskStateError(ValueError):
    message: str

    def __str__(self) -> str:
        return self.message


def get_task_row(conn: sqlite3.Connection, task_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
    if row is None:
        raise TaskStateError("Task not found")
    return row


def transition_task(
    conn: sqlite3.Connection,
    task_id: str,
    event: str,
    *,
    now_iso: str,
    started_at: str | None = None,
    finished_at: str | None = None,
    review_admin_id: int | None = None,
    danger_level: str | None = None,
) -> sqlite3.Row:
    row = get_task_row(conn, task_id)

    if event in TASK_EVENT_TRANSITIONS:
        target_status = event
        if row["status"] not in TASK_EVENT_TRANSITIONS[event]:
            raise TaskStateError(f"Invalid task state transition: {row['status']} -> {event}")
        effective_started_at = row["started_at"]
        effective_finished_at = row["finished_at"]
        if event == "running" and effective_started_at is None:
            effective_started_at = started_at or now_iso
        if event in TERMINAL_TASK_STATUSES and effective_finished_at is None:
            effective_finished_at = finished_at or now_iso
        conn.execute(
            """
            UPDATE tasks
            SET status = ?, started_at = ?, finished_at = ?
            WHERE task_id = ?
            """,
            (target_status, effective_started_at, effective_finished_at, task_id),
        )
        return get_task_row(conn, task_id)

    if event == "cancel":
        if row["status"] in TERMINAL_TASK_STATUSES:
            raise TaskStateError("Task is already terminal")
        if row["status"] == "pending":
            conn.execute(
                """
                UPDATE tasks
                SET status = ?, finished_at = ?
                WHERE task_id = ?
                """,
                ("cancelled", finished_at or now_iso, task_id),
            )
            return get_task_row(conn, task_id)
        if row["status"] in ACTIVE_TASK_STATUSES:
            conn.execute(
                """
                UPDATE tasks
                SET status = ?, finished_at = COALESCE(?, finished_at)
                WHERE task_id = ?
                """,
                ("cancel_requested", finished_at, task_id),
            )
            return get_task_row(conn, task_id)
        raise TaskStateError("Task cannot be cancelled now")

    if event == "review_escalate":
        if row["status"] != "reviewing":
            raise TaskStateError("Task is not under review")
        if row["review_stage"] == 3:
            raise TaskStateError("Task is already in human review stage")
        conn.execute(
            """
            UPDATE tasks
            SET review_stage = 3, review_decision = 'pending_human', review_started_at = ?, review_finished_at = NULL
            WHERE task_id = ?
            """,
            (now_iso, task_id),
        )
        return get_task_row(conn, task_id)

    if event == "review_approve":
        if row["status"] != "reviewing" or row["review_stage"] != 3:
            raise TaskStateError("Task is not awaiting human approval")
        conn.execute(
            """
            UPDATE tasks
            SET status = 'pending',
                review_decision = 'human_approved',
                danger_level = COALESCE(?, danger_level),
                review_admin_id = ?,
                review_finished_at = ?
            WHERE task_id = ? AND status = 'reviewing'
            """,
            (danger_level or "human_approved", review_admin_id, now_iso, task_id),
        )
        return get_task_row(conn, task_id)

    if event == "review_reject":
        if row["status"] != "reviewing":
            raise TaskStateError("Task is not under review")
        conn.execute(
            """
            UPDATE tasks
            SET status = 'rejected',
                review_decision = 'human_rejected',
                review_admin_id = ?,
                review_finished_at = ?
            WHERE task_id = ? AND status = 'reviewing'
            """,
            (review_admin_id, now_iso, task_id),
        )
        return get_task_row(conn, task_id)

    if event == "review_expire":
        if row["status"] != "reviewing":
            raise TaskStateError("Task is not under review")
        conn.execute(
            """
            UPDATE tasks
            SET status = 'review_expired', review_decision = 'expired', review_finished_at = ?
            WHERE task_id = ? AND status = 'reviewing'
            """,
            (now_iso, task_id),
        )
        return get_task_row(conn, task_id)

    if event in {"background_timeout", "background_lost"}:
        target_status = "timeout" if event == "background_timeout" else "lost"
        conn.execute(
            """
            UPDATE tasks
            SET status = ?, finished_at = ?
            WHERE task_id = ?
            """,
            (target_status, finished_at or now_iso, task_id),
        )
        return get_task_row(conn, task_id)

    raise TaskStateError(f"Unsupported task transition event: {event}")


def finalize_task_result(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    final_status: str,
    started_at: str,
    finished_at: str,
    now_iso: str,
) -> tuple[sqlite3.Row, bool]:
    row = get_task_row(conn, task_id)
    if row["status"] not in RESULT_ACCEPTING_TASK_STATUSES and row["status"] not in TERMINAL_TASK_STATUSES:
        raise TaskStateError(f"Task in status {row['status']} cannot accept final result yet")

    updated = conn.execute(
        """
        UPDATE tasks
        SET status = ?, started_at = ?, finished_at = ?, result_locked_at = ?
        WHERE task_id = ?
          AND result_locked_at IS NULL
          AND status IN ('claimed', 'running', 'cancel_requested')
        """,
        (final_status, started_at, finished_at, now_iso, task_id),
    )
    if updated.rowcount != 1:
        row = get_task_row(conn, task_id)
        if row["status"] in TERMINAL_TASK_STATUSES:
            return row, True
        raise TaskStateError(f"Task in status {row['status']} cannot accept final result yet")
    return get_task_row(conn, task_id), False

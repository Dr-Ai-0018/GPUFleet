"""Background tasks for the GPUFleet control plane."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.config import get_settings
from app.db import Database, dumps_json, utc_now_iso
from app.services.task_state import transition_task
from app.task_utils import TERMINAL_TASK_STATUSES

logger = logging.getLogger(__name__)

SCAN_INTERVAL_SEC = 60
CANCEL_ACK_TIMEOUT_SEC = 300  # 5 minutes


def _parse_utc_or_none(raw: str | None) -> datetime | None:
    if not raw:
        return None
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _latest_cancel_requested_at(conn: object, task_id: str) -> datetime | None:
    row = conn.execute(
        """
        SELECT created_at
        FROM audit_events
        WHERE action = 'cancel_task' AND target_type = 'task' AND target_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (task_id,),
    ).fetchone()
    if row is None:
        return None
    return _parse_utc_or_none(row["created_at"])


def _is_within_root(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _cleanup_path(path: Path, expected_root: Path) -> None:
    if not _is_within_root(expected_root, path):
        logger.warning("Skip deleting path outside storage root: %s", path)
        return
    if path.is_file():
        path.unlink(missing_ok=True)
    if path.parent != expected_root and _is_within_root(expected_root, path.parent):
        try:
            path.parent.rmdir()
        except OSError:
            pass


def _prune_old_status_snapshots(db: Database) -> None:
    settings = get_settings()
    cutoff = (datetime.now(UTC) - timedelta(days=settings.snapshot_retention_days)).replace(microsecond=0).isoformat()
    with db.connect() as conn:
        conn.execute(
            "DELETE FROM node_status_snapshots WHERE reported_at < ?",
            (cutoff,),
        )


def _prune_old_task_logs(db: Database) -> None:
    settings = get_settings()
    cutoff = (datetime.now(UTC) - timedelta(days=settings.task_log_retention_days)).replace(microsecond=0).isoformat()
    logs_root = settings.storage_path / "logs"
    terminal_statuses = tuple(sorted(TERMINAL_TASK_STATUSES))
    placeholders = ", ".join("?" for _ in terminal_statuses)
    with db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT tl.id, tl.center_log_path
            FROM task_logs tl
            JOIN tasks t ON t.task_id = tl.task_id
            WHERE t.status IN ({placeholders})
              AND t.finished_at IS NOT NULL
              AND t.finished_at < ?
            """,
            (*terminal_statuses, cutoff),
        ).fetchall()
        for row in rows:
            log_path = row["center_log_path"]
            if log_path:
                _cleanup_path(Path(log_path), logs_root)
        conn.execute(
            f"""
            DELETE FROM task_logs
            WHERE id IN (
                SELECT tl.id
                FROM task_logs tl
                JOIN tasks t ON t.task_id = tl.task_id
                WHERE t.status IN ({placeholders})
                  AND t.finished_at IS NOT NULL
                  AND t.finished_at < ?
            )
            """,
            (*terminal_statuses, cutoff),
        )


def _prune_old_artifacts(db: Database) -> None:
    settings = get_settings()
    cutoff = (datetime.now(UTC) - timedelta(days=settings.artifact_retention_days)).replace(microsecond=0).isoformat()
    artifacts_root = settings.storage_path / "artifacts"
    terminal_statuses = tuple(sorted(TERMINAL_TASK_STATUSES))
    placeholders = ", ".join("?" for _ in terminal_statuses)
    with db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT a.id, a.storage_path
            FROM artifacts a
            JOIN tasks t ON t.task_id = a.task_id
            WHERE t.status IN ({placeholders})
              AND t.finished_at IS NOT NULL
              AND t.finished_at < ?
            """,
            (*terminal_statuses, cutoff),
        ).fetchall()
        for row in rows:
            storage_path = row["storage_path"]
            if storage_path:
                _cleanup_path(Path(storage_path), artifacts_root)
        conn.execute(
            f"""
            DELETE FROM artifacts
            WHERE id IN (
                SELECT a.id
                FROM artifacts a
                JOIN tasks t ON t.task_id = a.task_id
                WHERE t.status IN ({placeholders})
                  AND t.finished_at IS NOT NULL
                  AND t.finished_at < ?
            )
            """,
            (*terminal_statuses, cutoff),
        )


def _mark_lost_tasks(db: Database) -> None:
    """Scan for tasks stuck in active states due to unresponsive nodes.

    Rules:
    - claimed/running tasks whose node hasn't heartbeated in 3× heartbeat_interval → lost
    - cancel_requested tasks with no ack for 5 minutes → lost
    - running tasks past their timeout_sec → timeout
    """
    now = datetime.now(UTC)
    now_iso = utc_now_iso()

    with db.connect() as conn:
        # Find tasks in active states with their node's heartbeat info
        active_tasks = conn.execute(
            """
            SELECT t.task_id, t.status, t.node_id, t.timeout_sec, t.started_at, t.claimed_at,
                   n.last_seen_at, n.heartbeat_interval_sec
            FROM tasks t
            JOIN nodes n ON t.node_id = n.node_id
            WHERE t.status IN ('claimed', 'running', 'cancel_requested')
            """
        ).fetchall()

        for task in active_tasks:
            task_id = task["task_id"]
            status = task["status"]
            last_seen_at = task["last_seen_at"]
            heartbeat_interval = task["heartbeat_interval_sec"] or 5

            # Check server-side timeout enforcement for running tasks
            if status == "running" and task["started_at"]:
                started = datetime.fromisoformat(task["started_at"])
                if started.tzinfo is None:
                    started = started.replace(tzinfo=UTC)
                deadline = started + timedelta(seconds=task["timeout_sec"])
                if now > deadline:
                    transition_task(conn, task_id, "background_timeout", now_iso=now_iso, finished_at=now_iso)
                    conn.execute(
                        """
                        INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, detail_json, created_at)
                        VALUES ('system', 'background', 'task_timeout', 'task', ?, ?, ?)
                        """,
                        (
                            task_id,
                            dumps_json({"reason": "server_side_timeout_enforcement", "timeout_sec": task["timeout_sec"]}),
                            now_iso,
                        ),
                    )
                    logger.info("Task %s marked timeout (server-side enforcement)", task_id)
                    continue

            # Check cancel_requested ack timeout
            if status == "cancel_requested":
                cancel_requested_at = _latest_cancel_requested_at(conn, task_id)
                if cancel_requested_at and now - cancel_requested_at > timedelta(seconds=CANCEL_ACK_TIMEOUT_SEC):
                    transition_task(conn, task_id, "background_lost", now_iso=now_iso, finished_at=now_iso)
                    conn.execute(
                        """
                        INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, detail_json, created_at)
                        VALUES ('system', 'background', 'task_lost', 'task', ?, ?, ?)
                        """,
                        (
                            task_id,
                            dumps_json({
                                "reason": "cancel_ack_timeout",
                                "note": "node may still be running process",
                                "cancel_requested_at": cancel_requested_at.isoformat(),
                                "last_seen_at": last_seen_at,
                            }),
                            now_iso,
                        ),
                    )
                    logger.info("Task %s marked lost (cancel ack timeout exceeded)", task_id)
                    continue

            # Check node unresponsive for claimed/running tasks
            if status in ("claimed", "running"):
                if last_seen_at:
                    last_seen = _parse_utc_or_none(last_seen_at)
                    threshold = timedelta(seconds=3 * heartbeat_interval)
                    if last_seen and now - last_seen > threshold:
                        transition_task(conn, task_id, "background_lost", now_iso=now_iso, finished_at=now_iso)
                        conn.execute(
                            """
                            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, detail_json, created_at)
                            VALUES ('system', 'background', 'task_lost', 'task', ?, ?, ?)
                            """,
                            (
                                task_id,
                                dumps_json({
                                    "reason": "node_unresponsive",
                                    "last_seen_at": last_seen_at,
                                    "heartbeat_interval_sec": heartbeat_interval,
                                }),
                                now_iso,
                            ),
                        )
                        logger.info("Task %s marked lost (node %s unresponsive)", task_id, task["node_id"])
                elif not last_seen_at:
                    # Node has never heartbeated — if task has been claimed, mark lost
                    claimed_at = task["claimed_at"]
                    if claimed_at:
                        claimed = _parse_utc_or_none(claimed_at)
                        if claimed and now - claimed > timedelta(seconds=3 * heartbeat_interval):
                            transition_task(conn, task_id, "background_lost", now_iso=now_iso, finished_at=now_iso)
                            conn.execute(
                                """
                                INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, detail_json, created_at)
                                VALUES ('system', 'background', 'task_lost', 'task', ?, ?, ?)
                                """,
                                (
                                    task_id,
                                    dumps_json({"reason": "node_never_seen", "claimed_at": claimed_at}),
                                    now_iso,
                                ),
                            )
                            logger.info("Task %s marked lost (node %s never seen)", task_id, task["node_id"])


def _expire_reviewing_tasks(db: Database) -> None:
    now_iso = utc_now_iso()
    cutoff = (datetime.now(UTC) - timedelta(minutes=30)).replace(microsecond=0).isoformat()
    with db.connect() as conn:
        expired = conn.execute(
            """
            SELECT task_id
            FROM tasks
            WHERE status = 'reviewing' AND review_started_at IS NOT NULL AND review_started_at < ?
            """,
            (cutoff,),
        ).fetchall()
        for row in expired:
            transition_task(conn, row["task_id"], "review_expire", now_iso=now_iso)
            conn.execute(
                """
                UPDATE alert_messages
                SET status = 'expired'
                WHERE target_type = 'task' AND target_id = ? AND status = 'unread'
                """,
                (row["task_id"],),
            )


async def lost_task_scanner(db: Database) -> None:
    """Periodically scan for lost/timed-out tasks."""
    while True:
        try:
            db.prune_expired_nonces(utc_now_iso())
            _mark_lost_tasks(db)
            _expire_reviewing_tasks(db)
            _prune_old_status_snapshots(db)
            _prune_old_task_logs(db)
            _prune_old_artifacts(db)
        except Exception:
            logger.exception("Error in lost task scanner")
        await asyncio.sleep(SCAN_INTERVAL_SEC)

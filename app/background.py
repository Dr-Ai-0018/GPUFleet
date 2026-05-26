"""Background tasks for the GPUFleet control plane."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from app.db import Database, dumps_json, utc_now_iso

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
                    conn.execute(
                        "UPDATE tasks SET status = 'timeout', finished_at = ? WHERE task_id = ?",
                        (now_iso, task_id),
                    )
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
                    conn.execute(
                        "UPDATE tasks SET status = 'lost', finished_at = ? WHERE task_id = ?",
                        (now_iso, task_id),
                    )
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
                        conn.execute(
                            "UPDATE tasks SET status = 'lost', finished_at = ? WHERE task_id = ?",
                            (now_iso, task_id),
                        )
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
                            conn.execute(
                                "UPDATE tasks SET status = 'lost', finished_at = ? WHERE task_id = ?",
                                (now_iso, task_id),
                            )
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


async def lost_task_scanner(db: Database) -> None:
    """Periodically scan for lost/timed-out tasks."""
    while True:
        try:
            db.prune_expired_nonces(utc_now_iso())
            _mark_lost_tasks(db)
        except Exception:
            logger.exception("Error in lost task scanner")
        await asyncio.sleep(SCAN_INTERVAL_SEC)

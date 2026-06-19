"""Background tasks for the GPUFleet control plane."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app import metrics as gm
from app.config import get_settings
from app.db import Database, dumps_json, utc_now_iso
from app.logging_config import get_logger
from app.services.task_state import transition_task
from app.task_utils import TERMINAL_TASK_STATUSES
from app.webhook import emit_event as _emit

logger = get_logger(__name__)

SCAN_INTERVAL_SEC = 60
CANCEL_ACK_TIMEOUT_SEC = 300  # 5 minutes

# 节点 offline 状态 (用于 _refresh_status_gauges 内 detect "新失联节点" 发 webhook), 进程内即时缓存
_offline_node_cache: set[str] = set()
_scanner_first_tick: bool = True


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
        logger.warning("skip_delete_outside_storage_root", path=str(path))
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
                    logger.info("task_marked_timeout", task_id=task_id, reason="server_side_enforcement")
                    _emit(
                        "task.failed",
                        {"task_id": task_id, "node_id": task["node_id"], "failure_reason": "timeout", "timeout_sec": task["timeout_sec"]},
                        severity="warning",
                    )
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
                    logger.info("task_marked_lost", task_id=task_id, reason="cancel_ack_timeout_exceeded")
                    _emit(
                        "task.lost",
                        {"task_id": task_id, "node_id": task["node_id"], "reason": "cancel_ack_timeout"},
                        severity="warning",
                    )
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
                        logger.info("task_marked_lost", task_id=task_id, node_id=task["node_id"], reason="node_unresponsive")
                        _emit(
                            "task.lost",
                            {"task_id": task_id, "node_id": task["node_id"], "reason": "node_unresponsive", "last_seen_at": last_seen_at},
                            severity="warning",
                        )
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
                            logger.info("task_marked_lost", task_id=task_id, node_id=task["node_id"], reason="node_never_seen")
                            _emit(
                                "task.lost",
                                {"task_id": task_id, "node_id": task["node_id"], "reason": "node_never_seen"},
                                severity="warning",
                            )


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
            _emit(
                "review.expired",
                {"task_id": row["task_id"], "timeout_minutes": 30},
                severity="warning",
            )


_JOB_REGISTRY: tuple[tuple[str, Callable[[Database], None]], ...] = (
    ("mark_lost", _mark_lost_tasks),
    ("expire_reviewing", _expire_reviewing_tasks),
    ("prune_snapshots", _prune_old_status_snapshots),
    ("prune_logs", _prune_old_task_logs),
    ("prune_artifacts", _prune_old_artifacts),
)


def _run_background_job(job_name: str, fn: Callable[[Database], None], db: Database) -> None:
    """跑单个后台清理任务, 自动埋时长直方图 + 错误 counter."""
    with gm.BACKGROUND_JOB_DURATION_SECONDS.labels(job=job_name).time():
        try:
            fn(db)
        except Exception:
            gm.BACKGROUND_JOB_ERRORS_TOTAL.labels(job=job_name).inc()
            logger.exception("background_job_failed", job=job_name)


def _refresh_status_gauges(db: Database) -> None:
    """刷新节点/任务/审核 gauge + detect 新失联节点发 webhook. 每轮 scanner tick 调一次."""
    global _scanner_first_tick
    try:
        settings = get_settings()
        with db.connect() as conn:
            # 拉每个节点 + 状态, 用于 gauge 聚合 + offline 单点 detect
            rows = conn.execute(
                """
                SELECT node_id, last_seen_at,
                       CASE
                           WHEN is_enabled = 0 THEN 'disabled'
                           WHEN last_seen_at IS NULL THEN 'never_seen'
                           WHEN datetime(last_seen_at) < datetime('now', '-30 seconds') THEN 'offline'
                           ELSE 'online'
                       END AS status
                FROM nodes
                """
            ).fetchall()
            node_counts: dict[str, int] = {}
            current_offline: set[str] = set()
            for row in rows:
                node_counts[row["status"]] = node_counts.get(row["status"], 0) + 1
                if row["status"] == "offline":
                    current_offline.add(row["node_id"])
                if row["last_seen_at"]:
                    last_seen = _parse_utc_or_none(row["last_seen_at"])
                    if last_seen:
                        gm.NODE_ONLINE_SECONDS.labels(node_id=row["node_id"]).set(
                            max(0.0, (datetime.now(UTC) - last_seen).total_seconds())
                        )
            gm.update_nodes_by_status(node_counts)

            task_counts = {
                row["status"]: row["c"]
                for row in conn.execute(
                    "SELECT status, COUNT(*) AS c FROM tasks GROUP BY status"
                ).fetchall()
            }
            gm.update_tasks_by_status(task_counts)
            gm.REVIEW_PENDING.set(task_counts.get("reviewing", 0))

        gm.update_storage_bytes(settings.storage_path)

        # 首次 tick 只填缓存, 不发 webhook (避免冷启动时把存量 offline 节点全发一遍噪音风暴)
        if not _scanner_first_tick:
            newly_offline = current_offline - _offline_node_cache
            for node_id in newly_offline:
                _emit("node.offline", {"node_id": node_id}, severity="warning")
            # D3 §4.1 node.online: 上一轮 offline 现在不在 offline 集合 → 恢复信号
            # severity=info (恢复事件不该用 warning, 避免接收方误判为新故障)
            recovered = _offline_node_cache - current_offline
            for node_id in recovered:
                _emit("node.online", {"node_id": node_id}, severity="info")
        _scanner_first_tick = False
        _offline_node_cache.clear()
        _offline_node_cache.update(current_offline)
    except Exception:
        logger.exception("status_gauges_refresh_failed")


async def lost_task_scanner(db: Database) -> None:
    """Periodically scan for lost/timed-out tasks + refresh Prometheus gauges + 发 webhook 事件.

    Webhook 事件通过 app.webhook.emit_event() 全局入口发出, lifespan 启动时已 set_global_emitter().
    """
    global _scanner_first_tick
    _scanner_first_tick = True
    while True:
        try:
            db.prune_expired_nonces(utc_now_iso())
            for job_name, fn in _JOB_REGISTRY:
                _run_background_job(job_name, fn, db)
            _refresh_status_gauges(db)
        except Exception:
            logger.exception("lost_task_scanner_outer_loop_error")
        await asyncio.sleep(SCAN_INTERVAL_SEC)

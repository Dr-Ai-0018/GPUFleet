from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db import Database, utc_now_iso
from app.deps import get_current_admin, get_db
from app.schemas import DashboardNodeCard, DashboardOverview, DashboardTaskSummary, NodeStatusPreview

router = APIRouter(prefix="/api/admin/dashboard", tags=["admin-dashboard"])


def _decode_gpu_snapshot(raw_gpu_json: str) -> tuple[list[dict[str, object]], dict[str, object]]:
    parsed = json.loads(raw_gpu_json)
    if isinstance(parsed, list):
        return parsed, {}
    if isinstance(parsed, dict):
        gpus = parsed.get("gpus", [])
        nvidia = parsed.get("nvidia", {})
        return gpus if isinstance(gpus, list) else [], nvidia if isinstance(nvidia, dict) else {}
    return [], {}


def _parse_iso_or_none(raw: str | None) -> datetime | None:
    if not raw:
        return None
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _compute_online_status(
    *,
    is_enabled: bool,
    first_seen_at: str | None,
    last_seen_at: str | None,
    heartbeat_interval_sec: int,
    now_utc: datetime,
) -> str:
    if not is_enabled:
        return "disabled"
    if not first_seen_at:
        return "never_seen"
    seen_at = _parse_iso_or_none(last_seen_at)
    if seen_at is None:
        return "offline"
    if seen_at >= now_utc - timedelta(seconds=heartbeat_interval_sec * 3):
        return "online"
    return "offline"


def _compute_onboarding_status(*, is_enabled: bool, first_seen_at: str | None) -> str:
    if not is_enabled:
        return "disabled"
    if not first_seen_at:
        return "awaiting_first_heartbeat"
    return "connected"


@router.get("/overview", response_model=DashboardOverview)
def get_overview(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> DashboardOverview:
    now_iso = utc_now_iso()
    now_utc = datetime.now(UTC)
    with db.connect() as conn:
        node_rows = conn.execute(
            """
            SELECT *
            FROM nodes
            ORDER BY created_at ASC, id ASC
            """
        ).fetchall()
        recent_task_rows = conn.execute(
            """
            SELECT task_id, node_id, type, status, created_at, claimed_at, started_at, finished_at
            FROM tasks
            ORDER BY created_at DESC, id DESC
            LIMIT 30
            """
        ).fetchall()
        task_count_rows = conn.execute(
            """
            SELECT status, COUNT(*) AS count_value
            FROM tasks
            GROUP BY status
            """
        ).fetchall()

        throughput_rows = conn.execute(
            """
            SELECT
                CAST(strftime('%H', datetime(finished_at, '+8 hours')) AS INTEGER) AS hour,
                COUNT(*) AS cnt
            FROM tasks
            WHERE status IN ('succeeded', 'failed', 'timeout', 'cancelled', 'lost')
              AND date(datetime(finished_at, '+8 hours')) = date('now', '+8 hours')
            GROUP BY hour
            """
        ).fetchall()

        nodes: list[DashboardNodeCard] = []
        for row in node_rows:
            latest = conn.execute(
                """
                SELECT reported_at, cpu_json, memory_json, disk_json, gpu_json, python_env_json, task_runtime_json, raw_payload_json
                FROM node_status_snapshots
                WHERE node_id = ? AND cpu_json IS NOT NULL
                ORDER BY reported_at DESC, id DESC
                LIMIT 1
                """,
                (row["node_id"],),
            ).fetchone()
            active_task_row = conn.execute(
                """
                SELECT task_id, type, status, started_at, claimed_at
                FROM tasks
                WHERE node_id = ? AND status IN ('claimed', 'running', 'cancel_requested')
                ORDER BY started_at DESC, claimed_at DESC, id DESC
                LIMIT 1
                """,
                (row["node_id"],),
            ).fetchone()

            latest_status = None
            if latest is not None:
                gpus, nvidia = _decode_gpu_snapshot(latest["gpu_json"])
                raw_payload = json.loads(latest["raw_payload_json"]) if latest["raw_payload_json"] else {}
                latest_status = NodeStatusPreview(
                    reported_at=latest["reported_at"],
                    cpu=json.loads(latest["cpu_json"]),
                    memory=json.loads(latest["memory_json"]),
                    disks=json.loads(latest["disk_json"]),
                    gpus=gpus,
                    nvidia=nvidia,
                    python_env=json.loads(latest["python_env_json"]),
                    task_runtime=json.loads(latest["task_runtime_json"]),
                    extra=raw_payload.get("extra", {}) if isinstance(raw_payload, dict) else {},
                )

            nodes.append(
                DashboardNodeCard(
                    node_id=row["node_id"],
                    display_name=row["display_name"],
                    node_type=row["node_type"],
                    os_type=row["os_type"],
                    hostname=row["hostname"],
                    tags=json.loads(row["tags_json"]),
                    is_enabled=bool(row["is_enabled"]),
                    heartbeat_interval_sec=row["heartbeat_interval_sec"],
                    first_seen_at=row["first_seen_at"],
                    last_seen_at=row["last_seen_at"],
                    online_status=_compute_online_status(
                        is_enabled=bool(row["is_enabled"]),
                        first_seen_at=row["first_seen_at"],
                        last_seen_at=row["last_seen_at"],
                        heartbeat_interval_sec=row["heartbeat_interval_sec"],
                        now_utc=now_utc,
                    ),
                    onboarding_status=_compute_onboarding_status(
                        is_enabled=bool(row["is_enabled"]),
                        first_seen_at=row["first_seen_at"],
                    ),
                    latest_status=latest_status,
                    active_task=(
                        {
                            "task_id": active_task_row["task_id"],
                            "type": active_task_row["type"],
                            "status": active_task_row["status"],
                            "started_at": active_task_row["started_at"],
                            "claimed_at": active_task_row["claimed_at"],
                        }
                        if active_task_row is not None
                        else None
                    ),
                )
            )

    node_counts = {
        "total": len(nodes),
        "online": sum(1 for item in nodes if item.online_status == "online"),
        "offline": sum(1 for item in nodes if item.online_status == "offline"),
        "disabled": sum(1 for item in nodes if item.online_status == "disabled"),
        "never_seen": sum(1 for item in nodes if item.online_status == "never_seen"),
    }
    task_counts = {row["status"]: row["count_value"] for row in task_count_rows}
    task_throughput_24h = [0] * 24
    for row in throughput_rows:
        h = row["hour"]
        if h is not None and 0 <= h <= 23:
            task_throughput_24h[h] = row["cnt"]
    recent_tasks = [
        DashboardTaskSummary(
            task_id=row["task_id"],
            node_id=row["node_id"],
            type=row["type"],
            status=row["status"],
            created_at=row["created_at"],
            claimed_at=row["claimed_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
        )
        for row in recent_task_rows
    ]

    return DashboardOverview(
        server_time=now_iso,
        node_counts=node_counts,
        task_counts=task_counts,
        nodes=nodes,
        recent_tasks=recent_tasks,
        task_throughput_24h=task_throughput_24h,
    )

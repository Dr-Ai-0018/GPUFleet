from __future__ import annotations

import gzip
import json
import sqlite3
from base64 import b64decode
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import Request, status

from app.config import Settings
from app.db import Database, dumps_json, utc_now_iso
from app.errors import ApiError
from app.schemas import (
    HeartbeatRequest,
    HeartbeatResponse,
    NodeArtifactUploadRequest,
    NodeTaskEventRequest,
    NodeTaskLogChunkRequest,
    NodeTaskResultRequest,
    TaskControlCommand,
    TaskEnvelope,
)
from app.security import decrypt_node_signing_key, hash_request_body, verify_node_request_signature
from app.services.task_state import TaskStateError, finalize_task_result, transition_task


def parse_timestamp(raw_timestamp: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(raw_timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ApiError(
            code="ERR_AUTH_INVALID_TIMESTAMP",
            message="Invalid timestamp format",
            status_code=status.HTTP_401_UNAUTHORIZED,
            details={"timestamp": raw_timestamp},
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def authenticate_node(
    request: Request,
    db: Database,
    settings: Settings,
    body: bytes,
) -> tuple[str, object]:
    node_id = request.headers.get("X-Node-Id")
    timestamp = request.headers.get("X-Timestamp")
    nonce = request.headers.get("X-Nonce")
    signature = request.headers.get("X-Signature")

    if not all([node_id, timestamp, nonce, signature]):
        raise ApiError(
            code="ERR_AUTH_MISSING_HEADERS",
            message="Missing node authentication headers",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    request_time = parse_timestamp(timestamp)
    now = datetime.now(UTC)
    skew = abs((now - request_time).total_seconds())
    if skew > settings.node_allowed_clock_skew_sec:
        raise ApiError(
            code="ERR_AUTH_TIMESTAMP_SKEW",
            message="Timestamp skew too large",
            status_code=status.HTTP_401_UNAUTHORIZED,
            details={"skew_sec": skew, "allowed_skew_sec": settings.node_allowed_clock_skew_sec},
        )

    body_hash = hash_request_body(body)
    now_iso = utc_now_iso()

    with db.connect() as conn:
        node = conn.execute(
            "SELECT * FROM nodes WHERE node_id = ? AND is_enabled = 1",
            (node_id,),
        ).fetchone()
        if node is None:
            raise ApiError(
                code="ERR_AUTH_NODE_NOT_FOUND_OR_DISABLED",
                message="Node not found or disabled",
                status_code=status.HTTP_401_UNAUTHORIZED,
                details={"node_id": node_id},
            )

        stored_signing_key = node["node_signing_key"] or ""
        encrypted_signing_key = node["encrypted_signing_key"] or ""
        if encrypted_signing_key:
            try:
                stored_signing_key = decrypt_node_signing_key(settings, encrypted_signing_key)
            except ValueError as exc:
                raise ApiError(
                    code="ERR_AUTH_SIGNING_KEY_UNAVAILABLE",
                    message="Node signing key unavailable",
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    details={"node_id": node_id},
                ) from exc

        if not stored_signing_key:
            raise ApiError(
                code="ERR_AUTH_SIGNING_KEY_UNAVAILABLE",
                message="Node signing key unavailable",
                status_code=status.HTTP_401_UNAUTHORIZED,
                details={"node_id": node_id},
            )

        if not verify_node_request_signature(
            stored_signing_key,
            node_id,
            timestamp,
            nonce,
            body_hash,
            signature,
        ):
            raise ApiError(
                code="ERR_AUTH_INVALID_SIGNATURE",
                message="Invalid node signature",
                status_code=status.HTTP_401_UNAUTHORIZED,
                details={"node_id": node_id},
            )

        expires_at = (now + timedelta(seconds=settings.nonce_ttl_sec)).replace(microsecond=0).isoformat()
        try:
            conn.execute(
                "INSERT INTO nonces (node_id, nonce, timestamp_utc, expires_at) VALUES (?, ?, ?, ?)",
                (node_id, nonce, timestamp, expires_at),
            )
        except sqlite3.IntegrityError as exc:
            raise ApiError(
                code="ERR_AUTH_NONCE_DUPLICATE",
                message="Duplicate nonce",
                status_code=status.HTTP_409_CONFLICT,
                details={"node_id": node_id, "nonce": nonce},
            ) from exc

        updated = conn.execute(
            """
            UPDATE nodes
            SET last_request_ts = ?, updated_at = ?
            WHERE node_id = ?
              AND is_enabled = 1
              AND (last_request_ts IS NULL OR last_request_ts < ?)
            """,
            (timestamp, now_iso, node_id, timestamp),
        )
        if updated.rowcount != 1:
            raise ApiError(
                code="ERR_AUTH_TIMESTAMP_REPLAY",
                message="Timestamp must be strictly increasing",
                status_code=status.HTTP_409_CONFLICT,
                details={"node_id": node_id, "timestamp": timestamp},
            )

    return node_id, node


def load_task_for_node(conn: object, node_id: str, task_id: str) -> object:
    row = conn.execute(
        "SELECT * FROM tasks WHERE task_id = ? AND node_id = ?",
        (task_id, node_id),
    ).fetchone()
    if row is None:
        raise ApiError(
            code="ERR_TASK_NOT_FOUND",
            message="Task not found for node",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"node_id": node_id, "task_id": task_id},
        )
    return row


def upsert_task_attempt(
    conn: object,
    task_id: str,
    node_id: str,
    status_value: str,
    *,
    boot_id: str | None = None,
    pid: int | None = None,
    pgid_or_job_id: str | None = None,
    started_at: str | None = None,
    finished_at: str | None = None,
    exit_code: int | None = None,
    summary: dict[str, object] | None = None,
) -> None:
    summary_json = dumps_json(summary or {}) if summary is not None else None
    existing = conn.execute(
        "SELECT * FROM task_attempts WHERE task_id = ? ORDER BY id DESC LIMIT 1",
        (task_id,),
    ).fetchone()
    if existing is None:
        conn.execute(
            """
            INSERT INTO task_attempts (
                task_id, node_id, agent_boot_id, pid, pgid_or_job_id, status,
                started_at, finished_at, exit_code, result_summary_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                node_id,
                boot_id,
                pid,
                pgid_or_job_id,
                status_value,
                started_at,
                finished_at,
                exit_code,
                summary_json or "{}",
            ),
        )
        return

    conn.execute(
        """
        UPDATE task_attempts
        SET agent_boot_id = COALESCE(?, agent_boot_id),
            pid = COALESCE(?, pid),
            pgid_or_job_id = COALESCE(?, pgid_or_job_id),
            status = ?,
            started_at = COALESCE(?, started_at),
            finished_at = COALESCE(?, finished_at),
            exit_code = COALESCE(?, exit_code),
            result_summary_json = COALESCE(?, result_summary_json)
        WHERE id = ?
        """,
        (
            boot_id,
            pid,
            pgid_or_job_id,
            status_value,
            started_at,
            finished_at,
            exit_code,
            summary_json,
            existing["id"],
        ),
    )


def storage_usage_bytes(storage_root: Path) -> int:
    if not storage_root.exists():
        return 0
    return sum(path.stat().st_size for path in storage_root.rglob("*") if path.is_file())


def next_log_archive_path(log_path: Path) -> Path:
    stream_name = log_path.stem
    for index in range(1, 100_000):
        candidate = log_path.with_name(f"{stream_name}.{index:05d}.log.gz")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Too many archived log slices for {log_path}")


def rotate_log_stream(log_path: Path) -> None:
    if not log_path.exists() or log_path.stat().st_size == 0:
        return
    archive_path = next_log_archive_path(log_path)
    with log_path.open("rb") as src, gzip.open(archive_path, "wb", compresslevel=6) as dst:
        dst.write(src.read())
    log_path.write_bytes(b"")


def take_text_prefix_by_bytes(text: str, byte_limit: int) -> tuple[str, str]:
    if byte_limit <= 0 or not text:
        return "", text
    encoded = text.encode("utf-8")
    if len(encoded) <= byte_limit:
        return text, ""
    left = 0
    right = len(text)
    while left < right:
        mid = (left + right + 1) // 2
        if len(text[:mid].encode("utf-8")) <= byte_limit:
            left = mid
        else:
            right = mid - 1
    return text[:left], text[left:]


def append_log_chunk(storage_root: Path, task_id: str, stream: str, text: str, max_stream_bytes: int) -> str:
    log_dir = storage_root / "logs" / task_id
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{stream}.log"
    remaining_text = text
    while remaining_text:
        current_size = log_path.stat().st_size if log_path.exists() else 0
        remaining_bytes = max_stream_bytes - current_size
        if remaining_bytes <= 0:
            rotate_log_stream(log_path)
            current_size = 0
            remaining_bytes = max_stream_bytes
        chunk_text, remaining_text = take_text_prefix_by_bytes(remaining_text, remaining_bytes)
        if not chunk_text:
            rotate_log_stream(log_path)
            continue
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(chunk_text)
        if log_path.stat().st_size >= max_stream_bytes:
            rotate_log_stream(log_path)
    return str(log_path)


def mark_log_truncated(
    conn: object,
    *,
    task_id: str,
    stream: str,
    existing: object | None,
    now_iso: str,
    reason: str,
) -> None:
    if existing is None:
        conn.execute(
            """
            INSERT INTO task_logs (task_id, stream, last_offset, preview_text, center_log_path, is_truncated, truncated_notice, updated_at)
            VALUES (?, ?, 0, '', NULL, 1, ?, ?)
            """,
            (task_id, stream, reason, now_iso),
        )
        return
    conn.execute(
        """
        UPDATE task_logs
        SET is_truncated = 1, truncated_notice = ?, updated_at = ?
        WHERE id = ?
        """,
        (reason, now_iso, existing["id"]),
    )


def sanitize_artifact_name(name: str) -> str:
    candidate = Path(name)
    sanitized = candidate.name
    if not sanitized or sanitized in {".", ".."} or sanitized != name:
        raise ApiError(
            code="ERR_ARTIFACT_INVALID_NAME",
            message="Invalid artifact_name",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"artifact_name": name},
        )
    return sanitized


def first_gpu_metrics(payload: HeartbeatRequest) -> tuple[float | None, float | None, float | None, float | None]:
    if not payload.gpus:
        return None, None, None, None
    first_gpu = payload.gpus[0]
    gpu_memory_percent = None
    if first_gpu.total_vram_mb and first_gpu.total_vram_mb > 0 and first_gpu.used_vram_mb is not None:
        gpu_memory_percent = (float(first_gpu.used_vram_mb) / float(first_gpu.total_vram_mb)) * 100.0
    return (
        first_gpu.utilization_percent,
        gpu_memory_percent,
        first_gpu.temperature_c,
        first_gpu.power_draw_w,
    )


def _MiB_to_bytes(value: int | None) -> int | None:
    return value * 1024 * 1024 if value is not None else None


def _sample_vram_percent(vram_used_bytes: int | None, total_vram_mb: int | None) -> float | None:
    if vram_used_bytes is None or not total_vram_mb or total_vram_mb <= 0:
        return None
    return (float(vram_used_bytes) / float(total_vram_mb * 1024 * 1024)) * 100.0


def _compact_base_gpus(payload: HeartbeatRequest) -> list[dict] | None:
    """把心跳顶层 gpus 压缩为高密 sample 多卡数组格式 (供基准行 sample_gpus_json 列用)."""
    if not payload.gpus:
        return None
    return [
        {
            "idx": g.index,
            "util": g.utilization_percent,
            "temp_c": g.temperature_c,
            "vram_used_bytes": _MiB_to_bytes(g.used_vram_mb),
        }
        for g in payload.gpus
    ]


def _build_snapshot_rows(
    *,
    node_id: str,
    now_iso: str,
    payload: HeartbeatRequest,
    gpu_utilization_percent: float | None,
    gpu_memory_percent: float | None,
    gpu_temperature_c: float | None,
    gpu_power_draw_w: float | None,
) -> list[tuple]:
    """构造基准行 + 高密 sample 行的批插参数列表.

    基准行: 列化指标 + 完整 JSON 元数据 + sample_gpus_json (该时刻多卡数组).
    sample 行: 仅列化指标 (第一块卡的 util/temp 作为节点级代表) + sample_gpus_json (该时刻多卡数组).
    JSON 元数据列在 sample 行全为 NULL.
    """
    base_row = (
        node_id,
        now_iso,
        payload.cpu.usage_percent,
        payload.memory.usage_percent,
        gpu_utilization_percent,
        gpu_memory_percent,
        gpu_temperature_c,
        gpu_power_draw_w,
        dumps_json(payload.cpu.model_dump()),
        dumps_json(payload.memory.model_dump()),
        dumps_json([item.model_dump() for item in payload.disks]),
        dumps_json(
            {
                "gpus": [item.model_dump() for item in payload.gpus],
                "nvidia": payload.nvidia.model_dump(),
            }
        ),
        dumps_json(payload.python_env.model_dump()),
        dumps_json(payload.task_runtime.model_dump()),
        dumps_json(payload.model_dump(mode="json")),  # mode="json" 让 datetime 序列化为 ISO 字符串
        dumps_json(_compact_base_gpus(payload)) if payload.gpus else None,
    )

    rows: list[tuple] = [base_row]
    seen_ts: set[str] = {now_iso}
    for sample in payload.samples:
        sample_ts = sample.ts.isoformat()
        if sample_ts in seen_ts:
            # 与基准行或前一个 sample 重合 → 跳过, 避免主键/逻辑冲突
            continue
        seen_ts.add(sample_ts)

        first_sample_gpu = sample.gpus[0] if sample.gpus else None
        first_payload_gpu = payload.gpus[0] if payload.gpus else None
        sample_row = (
            node_id,
            sample_ts,
            sample.cpu_percent,
            sample.memory_percent,
            first_sample_gpu.util if first_sample_gpu else None,
            _sample_vram_percent(
                first_sample_gpu.vram_used_bytes if first_sample_gpu else None,
                first_payload_gpu.total_vram_mb if first_payload_gpu else None,
            ),
            first_sample_gpu.temp_c if first_sample_gpu else None,
            first_sample_gpu.power_w if first_sample_gpu else None,
            None,  # cpu_json
            None,  # memory_json
            None,  # disk_json
            None,  # gpu_json
            None,  # python_env_json
            None,  # task_runtime_json
            None,  # raw_payload_json
            dumps_json([g.model_dump() for g in sample.gpus]) if sample.gpus else None,
        )
        rows.append(sample_row)
    return rows


async def heartbeat(request: Request, db: Database, settings: Settings) -> HeartbeatResponse:
    """对外暴露的心跳入口, 包一层 Prometheus 指标 wrapper, 业务在 _heartbeat_impl 里."""
    from app import metrics as gm
    import time as _time

    started = _time.perf_counter()
    metric_node_id = request.headers.get("x-node-id", "unknown")
    try:
        response = await _heartbeat_impl(request, db, settings)
        gm.NODE_HEARTBEAT_TOTAL.labels(node_id=metric_node_id, result="ok").inc()
        return response
    except Exception:
        gm.NODE_HEARTBEAT_TOTAL.labels(node_id=metric_node_id, result="reject").inc()
        raise
    finally:
        gm.NODE_HEARTBEAT_DURATION_SECONDS.observe(_time.perf_counter() - started)


async def _heartbeat_impl(request: Request, db: Database, settings: Settings) -> HeartbeatResponse:
    body = await request.body()
    node_id, node = authenticate_node(request, db, settings, body)

    try:
        payload = HeartbeatRequest.model_validate_json(body)
    except Exception as exc:
        raise ApiError(
            code="ERR_VALIDATION_INVALID_PAYLOAD",
            message="Invalid heartbeat payload",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        ) from exc

    now_iso = utc_now_iso()
    gpu_utilization_percent, gpu_memory_percent, gpu_temperature_c, gpu_power_draw_w = first_gpu_metrics(payload)

    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            UPDATE nodes
            SET hostname = ?,
                heartbeat_interval_sec = ?,
                first_seen_at = COALESCE(first_seen_at, ?),
                last_seen_at = ?,
                last_boot_id = ?,
                onboarding_token_encrypted = NULL,
                onboarding_token_expires_at = NULL,
                updated_at = ?
            WHERE node_id = ?
            """,
            (
                payload.hostname or node["hostname"],
                payload.heartbeat_interval_sec,
                now_iso,
                now_iso,
                payload.boot_id,
                now_iso,
                node_id,
            ),
        )
        snapshot_rows = _build_snapshot_rows(
            node_id=node_id,
            now_iso=now_iso,
            payload=payload,
            gpu_utilization_percent=gpu_utilization_percent,
            gpu_memory_percent=gpu_memory_percent,
            gpu_temperature_c=gpu_temperature_c,
            gpu_power_draw_w=gpu_power_draw_w,
        )
        conn.executemany(
            """
            INSERT INTO node_status_snapshots (
                node_id, reported_at, cpu_usage_percent, memory_usage_percent,
                gpu_utilization_percent, gpu_memory_percent, gpu_temperature_c, gpu_power_draw_w,
                cpu_json, memory_json, disk_json, gpu_json,
                python_env_json, task_runtime_json, raw_payload_json,
                sample_gpus_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            snapshot_rows,
        )
        active_task_row = db.sync_reported_active_task(
            conn,
            node_id,
            payload.task_runtime.active_task_id,
            now_iso,
        )
        claimed_task = None if active_task_row is not None else db.claim_next_task_for_node(conn, node_id, now_iso)
        tasks = []
        task_controls = []
        if claimed_task is not None:
            tasks.append(
                TaskEnvelope(
                    task_id=claimed_task["task_id"],
                    revision=claimed_task["revision"],
                    idempotency_key=claimed_task["idempotency_key"],
                    type=claimed_task["type"],
                    payload=json.loads(claimed_task["payload_json"]),
                    workdir=claimed_task["workdir"],
                    env=json.loads(claimed_task["env_json"]),
                    requested_gpu_ids=json.loads(claimed_task["requested_gpu_ids_json"]),
                    timeout_sec=claimed_task["timeout_sec"],
                    kill_grace_sec=claimed_task["kill_grace_sec"],
                    danger_level=claimed_task["danger_level"],
                )
            )
        cancelling_rows = conn.execute(
            """
            SELECT task_id, kill_grace_sec
            FROM tasks
            WHERE node_id = ? AND status = 'cancel_requested'
            ORDER BY claimed_at DESC, id DESC
            """,
            (node_id,),
        ).fetchall()
        for cancel_row in cancelling_rows:
            task_controls.append(
                TaskControlCommand(
                    task_id=cancel_row["task_id"],
                    action="cancel",
                    kill_grace_sec=cancel_row["kill_grace_sec"],
                )
            )

    db.trim_node_status_history(node_id, settings.max_status_history_per_node)

    # 检查是否有管理员触发的指纹刷新请求 (in-memory pending set, lifespan 初始化).
    # 命中即下发 refresh_fingerprint=True 并从 set 移除 — 一次性触发, 不重复发.
    refresh_fingerprint = False
    pending: set[str] | None = getattr(request.app.state, "pending_fingerprint_refresh", None)
    if pending is not None and node_id in pending:
        pending.discard(node_id)
        refresh_fingerprint = True

    return HeartbeatResponse(
        server_time=now_iso,
        node_id=node_id,
        tasks=tasks,
        task_controls=task_controls,
        refresh_fingerprint=refresh_fingerprint,
    )


async def task_events(request: Request, db: Database, settings: Settings) -> dict[str, object]:
    body = await request.body()
    node_id, _ = authenticate_node(request, db, settings, body)
    try:
        payload = NodeTaskEventRequest.model_validate_json(body)
    except Exception as exc:
        raise ApiError(
            code="ERR_VALIDATION_INVALID_PAYLOAD",
            message="Invalid task event payload",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        ) from exc

    now_iso = utc_now_iso()
    with db.connect() as conn:
        load_task_for_node(conn, node_id, payload.task_id)
        try:
            updated_row = transition_task(
                conn,
                payload.task_id,
                payload.event,
                now_iso=now_iso,
                started_at=now_iso,
                finished_at=now_iso,
            )
        except TaskStateError as exc:
            raise ApiError(
                code="ERR_TASK_INVALID_STATE_TRANSITION",
                message=str(exc),
                status_code=status.HTTP_409_CONFLICT,
                details={"node_id": node_id, "task_id": payload.task_id, "event": payload.event},
            ) from exc
        upsert_task_attempt(
            conn,
            payload.task_id,
            node_id,
            payload.event,
            boot_id=payload.boot_id,
            pid=payload.pid,
            pgid_or_job_id=payload.pgid_or_job_id,
            started_at=updated_row["started_at"],
            finished_at=updated_row["finished_at"],
        )
    return {"ok": True, "task_id": payload.task_id, "status": payload.event}


async def task_log_chunk(request: Request, db: Database, settings: Settings) -> dict[str, object]:
    body = await request.body()
    node_id, _ = authenticate_node(request, db, settings, body)
    try:
        payload = NodeTaskLogChunkRequest.model_validate_json(body)
    except Exception as exc:
        raise ApiError(
            code="ERR_VALIDATION_INVALID_PAYLOAD",
            message="Invalid task log chunk payload",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        ) from exc

    now_iso = utc_now_iso()
    quota_exceeded = False
    with db.connect() as conn:
        load_task_for_node(conn, node_id, payload.task_id)
        existing = conn.execute(
            "SELECT id, preview_text, last_offset, is_truncated FROM task_logs WHERE task_id = ? AND stream = ?",
            (payload.task_id, payload.stream),
        ).fetchone()
        append_text = payload.text
        if existing is None and payload.offset_start != 0:
            raise ApiError(
                code="ERR_LOG_OFFSET_MUST_START_ZERO",
                message=f"Initial log chunk must start at offset 0 for {payload.stream}",
                status_code=status.HTTP_409_CONFLICT,
                details={"task_id": payload.task_id, "stream": payload.stream, "offset_start": payload.offset_start},
            )
        if existing is not None:
            last_offset = existing["last_offset"]
            if payload.offset_start < last_offset:
                overlap = last_offset - payload.offset_start
                if overlap >= len(payload.text):
                    append_text = ""
                else:
                    append_text = payload.text[overlap:]
            elif payload.offset_start > last_offset:
                raise ApiError(
                    code="ERR_LOG_OFFSET_GAP",
                    message=f"Log offset gap detected for {payload.stream}",
                    status_code=status.HTTP_409_CONFLICT,
                    details={
                        "task_id": payload.task_id,
                        "stream": payload.stream,
                        "expected_offset": last_offset,
                        "offset_start": payload.offset_start,
                    },
                )
        if existing is not None and bool(existing["is_truncated"]):
            raise ApiError(
                code="ERR_LOG_STREAM_TRUNCATED",
                message=f"Log stream {payload.stream} is already truncated",
                status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
                details={"task_id": payload.task_id, "stream": payload.stream},
            )
        append_bytes = len(append_text.encode("utf-8"))
        if append_bytes and storage_usage_bytes(settings.storage_path) + append_bytes > settings.storage_quota_bytes:
            mark_log_truncated(
                conn,
                task_id=payload.task_id,
                stream=payload.stream,
                existing=existing,
                now_iso=now_iso,
                reason="storage_quota_exceeded",
            )
            quota_exceeded = True
            from app.webhook import emit_event
            emit_event(
                "storage.quota_exceeded",
                {
                    "task_id": payload.task_id,
                    "stream": payload.stream,
                    "quota_bytes": settings.storage_quota_bytes,
                    "attempted_bytes": append_bytes,
                },
                severity="critical",
            )
        if not quota_exceeded:
            log_path = append_log_chunk(
                settings.storage_path,
                payload.task_id,
                payload.stream,
                append_text,
                settings.task_log_stream_max_bytes,
            )
            preview = append_text[-4000:]
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO task_logs (task_id, stream, last_offset, preview_text, center_log_path, is_truncated, truncated_notice, updated_at)
                    VALUES (?, ?, ?, ?, ?, 0, '', ?)
                    """,
                    (
                        payload.task_id,
                        payload.stream,
                        payload.offset_start + len(payload.text),
                        preview,
                        log_path,
                        now_iso,
                    ),
                )
            else:
                merged_preview = (existing["preview_text"] + append_text)[-4000:]
                conn.execute(
                    """
                    UPDATE task_logs
                    SET last_offset = ?, preview_text = ?, center_log_path = ?, is_truncated = 0, truncated_notice = '', updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        max(existing["last_offset"], payload.offset_start + len(payload.text)),
                        merged_preview,
                        log_path,
                        now_iso,
                        existing["id"],
                    ),
                )

    if quota_exceeded:
        raise ApiError(
            code="ERR_STORAGE_QUOTA_EXCEEDED",
            message="Storage quota exceeded; log chunk rejected",
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            details={"task_id": payload.task_id, "stream": payload.stream},
        )
    return {
        "ok": True,
        "task_id": payload.task_id,
        "stream": payload.stream,
        "stored_bytes": len(append_text),
        "is_final": payload.is_final,
    }


async def task_result(request: Request, db: Database, settings: Settings) -> dict[str, object]:
    body = await request.body()
    node_id, _ = authenticate_node(request, db, settings, body)
    try:
        payload = NodeTaskResultRequest.model_validate_json(body)
    except Exception as exc:
        raise ApiError(
            code="ERR_VALIDATION_INVALID_PAYLOAD",
            message="Invalid task result payload",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        ) from exc

    now_iso = utc_now_iso()
    with db.connect() as conn:
        finished_at = payload.finished_at or now_iso
        current_row = load_task_for_node(conn, node_id, payload.task_id)
        started_at = payload.started_at or current_row["started_at"] or now_iso
        try:
            updated_row, duplicate = finalize_task_result(
                conn,
                payload.task_id,
                final_status=payload.final_status,
                started_at=started_at,
                finished_at=finished_at,
                now_iso=now_iso,
            )
        except TaskStateError as exc:
            raise ApiError(
                code="ERR_TASK_INVALID_STATE_TRANSITION",
                message=str(exc),
                status_code=status.HTTP_409_CONFLICT,
                details={"node_id": node_id, "task_id": payload.task_id, "final_status": payload.final_status},
            ) from exc
        if duplicate:
            return {"ok": True, "task_id": payload.task_id, "status": updated_row["status"], "duplicate": True}
        upsert_task_attempt(
            conn,
            payload.task_id,
            node_id,
            payload.final_status,
            boot_id=payload.boot_id,
            pid=payload.pid,
            pgid_or_job_id=payload.pgid_or_job_id,
            started_at=started_at,
            finished_at=finished_at,
            exit_code=payload.exit_code,
            summary=payload.summary,
        )
    return {"ok": True, "task_id": payload.task_id, "status": payload.final_status}


async def artifact_upload(request: Request, db: Database, settings: Settings) -> dict[str, object]:
    from app import metrics as gm

    def reject(result: str) -> None:
        gm.ARTIFACT_UPLOAD_TOTAL.labels(result=result).inc()

    content_length = request.headers.get("Content-Length")
    if content_length is not None:
        try:
            request_size = int(content_length)
        except ValueError as exc:
            reject("reject_invalid")
            raise ApiError(
                code="ERR_ARTIFACT_INVALID_CONTENT_LENGTH",
                message="Invalid Content-Length header",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"content_length": content_length},
            ) from exc
        max_encoded_bytes = (settings.max_artifact_bytes * 4 // 3) + 4096
        if request_size > max_encoded_bytes:
            reject("reject_size")
            raise ApiError(
                code="ERR_PAYLOAD_TOO_LARGE",
                message=f"Artifact request exceeds size limit ({settings.max_artifact_bytes} bytes decoded)",
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                details={"limit_bytes": settings.max_artifact_bytes, "request_size_bytes": request_size},
            )

    body = await request.body()
    node_id, _ = authenticate_node(request, db, settings, body)
    try:
        payload = NodeArtifactUploadRequest.model_validate_json(body)
    except Exception as exc:
        reject("reject_invalid")
        raise ApiError(
            code="ERR_VALIDATION_INVALID_PAYLOAD",
            message="Invalid artifact upload payload",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        ) from exc

    with db.connect() as conn:
        load_task_for_node(conn, node_id, payload.task_id)

    estimated_decoded_size = len(payload.content_base64) * 3 // 4
    if estimated_decoded_size > settings.max_artifact_bytes:
        reject("reject_size")
        raise ApiError(
            code="ERR_PAYLOAD_TOO_LARGE",
            message=f"Artifact exceeds size limit ({settings.max_artifact_bytes} bytes)",
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            details={"limit_bytes": settings.max_artifact_bytes, "estimated_size_bytes": estimated_decoded_size},
        )

    try:
        content = b64decode(payload.content_base64.encode("utf-8"), validate=True)
    except Exception as exc:
        reject("reject_invalid")
        raise ApiError(
            code="ERR_ARTIFACT_INVALID_BASE64",
            message="Invalid base64 artifact content",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"task_id": payload.task_id, "artifact_name": payload.artifact_name},
        ) from exc

    if len(content) > settings.max_artifact_bytes:
        reject("reject_size")
        raise ApiError(
            code="ERR_PAYLOAD_TOO_LARGE",
            message=f"Artifact exceeds size limit ({settings.max_artifact_bytes} bytes)",
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            details={"limit_bytes": settings.max_artifact_bytes, "size_bytes": len(content)},
        )

    now_iso = utc_now_iso()
    artifact_dir = settings.storage_path / "artifacts" / payload.task_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    try:
        artifact_name = sanitize_artifact_name(payload.artifact_name)
    except ApiError:
        reject("reject_invalid")
        raise
    artifact_path = artifact_dir / artifact_name
    artifact_path.write_bytes(content)

    with db.connect() as conn:
        existing = conn.execute(
            """
            SELECT id
            FROM artifacts
            WHERE task_id = ? AND artifact_name = ?
            """,
            (payload.task_id, artifact_name),
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO artifacts (
                    task_id, artifact_name, artifact_type, content_type, size_bytes,
                    storage_path, preview_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.task_id,
                    artifact_name,
                    payload.artifact_type,
                    payload.content_type,
                    len(content),
                    str(artifact_path),
                    dumps_json(payload.preview),
                    now_iso,
                ),
            )
        else:
            conn.execute(
                """
                UPDATE artifacts
                SET artifact_type = ?, content_type = ?, size_bytes = ?, storage_path = ?, preview_json = ?
                WHERE id = ?
                """,
                (
                    payload.artifact_type,
                    payload.content_type,
                    len(content),
                    str(artifact_path),
                    dumps_json(payload.preview),
                    existing["id"],
                ),
            )
    gm.ARTIFACT_UPLOAD_TOTAL.labels(result="ok").inc()
    gm.ARTIFACT_UPLOAD_BYTES_TOTAL.inc(len(content))
    return {
        "ok": True,
        "task_id": payload.task_id,
        "artifact_name": artifact_name,
        "size_bytes": len(content),
    }

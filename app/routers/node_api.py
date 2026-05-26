from __future__ import annotations

import json
import sqlite3
from base64 import b64decode
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi.util import get_ipaddr

from app.config import Settings
from app.db import Database, dumps_json, utc_now_iso
from app.deps import get_db, get_settings_dep
from app.routers.admin_auth import limiter
from app.schemas import (
    HeartbeatRequest,
    HeartbeatResponse,
    NodeTaskEventRequest,
    NodeArtifactUploadRequest,
    NodeTaskLogChunkRequest,
    NodeTaskResultRequest,
    TaskControlCommand,
    TaskEnvelope,
)
from app.security import decrypt_node_signing_key, hash_request_body, verify_node_request_signature
from app.task_utils import RESULT_ACCEPTING_TASK_STATUSES, TASK_EVENT_TRANSITIONS, TERMINAL_TASK_STATUSES

router = APIRouter(prefix="/api/node", tags=["node"])


def _node_rate_limit_key(request: Request) -> str:
    node_id = request.headers.get("X-Node-Id")
    if node_id:
        return node_id
    return f"unknown:{get_ipaddr(request)}"


def _parse_timestamp(raw_timestamp: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(raw_timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid timestamp format",
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _authenticate_node(
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing node authentication headers",
        )

    request_time = _parse_timestamp(timestamp)
    now = datetime.now(UTC)
    skew = abs((now - request_time).total_seconds())
    if skew > settings.node_allowed_clock_skew_sec:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Timestamp skew too large",
        )

    body_hash = hash_request_body(body)
    now_iso = utc_now_iso()

    with db.connect() as conn:
        node = conn.execute(
            "SELECT * FROM nodes WHERE node_id = ? AND is_enabled = 1",
            (node_id,),
        ).fetchone()
        if node is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Node not found or disabled",
            )

        stored_signing_key = node["node_signing_key"] or ""
        encrypted_signing_key = node["encrypted_signing_key"] or ""
        if encrypted_signing_key:
            try:
                stored_signing_key = decrypt_node_signing_key(settings, encrypted_signing_key)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Node signing key unavailable",
                ) from exc

        if not stored_signing_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Node signing key unavailable",
            )

        if not verify_node_request_signature(
            stored_signing_key,
            node_id,
            timestamp,
            nonce,
            body_hash,
            signature,
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid node signature",
            )

        expires_at = (now + timedelta(seconds=settings.nonce_ttl_sec)).replace(microsecond=0).isoformat()
        try:
            conn.execute(
                "INSERT INTO nonces (node_id, nonce, timestamp_utc, expires_at) VALUES (?, ?, ?, ?)",
                (node_id, nonce, timestamp, expires_at),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate nonce",
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
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Timestamp must be strictly increasing",
            )

    return node_id, node


def _load_task_for_node(conn: object, node_id: str, task_id: str) -> object:
    row = conn.execute(
        "SELECT * FROM tasks WHERE task_id = ? AND node_id = ?",
        (task_id, node_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found for node")
    return row


def _upsert_task_attempt(
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


def _append_log_chunk(storage_root: Path, task_id: str, stream: str, text: str) -> str:
    log_dir = storage_root / "logs" / task_id
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{stream}.log"
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(text)
    return str(log_path)


def _sanitize_artifact_name(name: str) -> str:
    candidate = Path(name)
    sanitized = candidate.name
    if not sanitized or sanitized in {".", ".."} or sanitized != name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid artifact_name",
        )
    return sanitized


@router.post("/heartbeat", response_model=HeartbeatResponse)
@limiter.limit("60/minute", key_func=_node_rate_limit_key)
async def heartbeat(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> HeartbeatResponse:
    body = await request.body()
    node_id, node = _authenticate_node(request, db, settings, body)

    try:
        payload = HeartbeatRequest.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid heartbeat payload",
        ) from exc

    now_iso = utc_now_iso()

    with db.connect() as conn:
        conn.execute(
            """
            UPDATE nodes
            SET hostname = ?,
                heartbeat_interval_sec = ?,
                first_seen_at = COALESCE(first_seen_at, ?),
                last_seen_at = ?,
                last_boot_id = ?,
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
        conn.execute(
            """
            INSERT INTO node_status_snapshots (
                node_id, reported_at, cpu_json, memory_json, disk_json, gpu_json,
                python_env_json, task_runtime_json, raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                node_id,
                now_iso,
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
                dumps_json(payload.model_dump()),
            ),
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

    return HeartbeatResponse(
        server_time=now_iso,
        node_id=node_id,
        tasks=tasks,
        task_controls=task_controls,
    )


@router.post("/task-events")
async def task_events(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, object]:
    body = await request.body()
    node_id, _ = _authenticate_node(request, db, settings, body)
    try:
        payload = NodeTaskEventRequest.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid task event payload") from exc

    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = _load_task_for_node(conn, node_id, payload.task_id)
        if row["status"] not in TASK_EVENT_TRANSITIONS[payload.event]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Invalid task state transition: {row['status']} -> {payload.event}",
            )

        started_at = row["started_at"]
        finished_at = row["finished_at"]
        if payload.event == "running" and started_at is None:
            started_at = now_iso
        if payload.event in TERMINAL_TASK_STATUSES and finished_at is None:
            finished_at = now_iso

        conn.execute(
            "UPDATE tasks SET status = ?, started_at = ?, finished_at = ? WHERE task_id = ?",
            (payload.event, started_at, finished_at, payload.task_id),
        )
        _upsert_task_attempt(
            conn,
            payload.task_id,
            node_id,
            payload.event,
            boot_id=payload.boot_id,
            pid=payload.pid,
            pgid_or_job_id=payload.pgid_or_job_id,
            started_at=started_at,
            finished_at=finished_at,
        )
    return {"ok": True, "task_id": payload.task_id, "status": payload.event}


@router.post("/task-log-chunk")
async def task_log_chunk(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, object]:
    body = await request.body()
    node_id, _ = _authenticate_node(request, db, settings, body)
    try:
        payload = NodeTaskLogChunkRequest.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid task log chunk payload") from exc

    now_iso = utc_now_iso()
    with db.connect() as conn:
        _load_task_for_node(conn, node_id, payload.task_id)
        existing = conn.execute(
            "SELECT id, preview_text, last_offset FROM task_logs WHERE task_id = ? AND stream = ?",
            (payload.task_id, payload.stream),
        ).fetchone()
        append_text = payload.text
        if existing is None and payload.offset_start != 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Initial log chunk must start at offset 0 for {payload.stream}",
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
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Log offset gap detected for {payload.stream}",
                )

        log_path = _append_log_chunk(settings.storage_path, payload.task_id, payload.stream, append_text)
        preview = append_text[-4000:]
        if existing is None:
            conn.execute(
                """
                INSERT INTO task_logs (task_id, stream, last_offset, preview_text, center_log_path, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
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
                SET last_offset = ?, preview_text = ?, center_log_path = ?, updated_at = ?
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
    return {
        "ok": True,
        "task_id": payload.task_id,
        "stream": payload.stream,
        "stored_bytes": len(append_text),
        "is_final": payload.is_final,
    }


@router.post("/task-result")
async def task_result(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, object]:
    body = await request.body()
    node_id, _ = _authenticate_node(request, db, settings, body)
    try:
        payload = NodeTaskResultRequest.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid task result payload") from exc

    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = _load_task_for_node(conn, node_id, payload.task_id)
        if row["status"] not in RESULT_ACCEPTING_TASK_STATUSES and row["status"] not in TERMINAL_TASK_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Task in status {row['status']} cannot accept final result yet",
            )

        finished_at = payload.finished_at or now_iso
        started_at = payload.started_at or row["started_at"] or now_iso
        updated = conn.execute(
            """
            UPDATE tasks
            SET status = ?, started_at = ?, finished_at = ?, result_locked_at = ?
            WHERE task_id = ?
              AND result_locked_at IS NULL
              AND status IN ('claimed', 'running', 'cancel_requested')
            """,
            (payload.final_status, started_at, finished_at, now_iso, payload.task_id),
        )
        if updated.rowcount != 1:
            row = _load_task_for_node(conn, node_id, payload.task_id)
            if row["status"] in TERMINAL_TASK_STATUSES:
                return {"ok": True, "task_id": payload.task_id, "status": row["status"], "duplicate": True}
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Task in status {row['status']} cannot accept final result yet",
            )
        _upsert_task_attempt(
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


@router.post("/artifact-upload")
async def artifact_upload(
    request: Request,
    db: Annotated[Database, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, object]:
    content_length = request.headers.get("Content-Length")
    if content_length is not None:
        try:
            request_size = int(content_length)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid Content-Length header",
            ) from exc
        max_encoded_bytes = (settings.max_artifact_bytes * 4 // 3) + 4096
        if request_size > max_encoded_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Artifact request exceeds size limit ({settings.max_artifact_bytes} bytes decoded)",
            )

    body = await request.body()
    node_id, _ = _authenticate_node(request, db, settings, body)
    try:
        payload = NodeArtifactUploadRequest.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid artifact upload payload") from exc

    # Verify task ownership BEFORE decoding/writing content
    with db.connect() as conn:
        _load_task_for_node(conn, node_id, payload.task_id)

    # Check size limit before decoding (base64 is ~4/3 of decoded size)
    estimated_decoded_size = len(payload.content_base64) * 3 // 4
    if estimated_decoded_size > settings.max_artifact_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Artifact exceeds size limit ({settings.max_artifact_bytes} bytes)",
        )

    try:
        content = b64decode(payload.content_base64.encode("utf-8"), validate=True)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid base64 artifact content") from exc

    if len(content) > settings.max_artifact_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Artifact exceeds size limit ({settings.max_artifact_bytes} bytes)",
        )

    now_iso = utc_now_iso()
    artifact_dir = settings.storage_path / "artifacts" / payload.task_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_name = _sanitize_artifact_name(payload.artifact_name)
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
    return {
        "ok": True,
        "task_id": payload.task_id,
        "artifact_name": artifact_name,
        "size_bytes": len(content),
    }

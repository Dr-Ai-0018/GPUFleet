from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import Settings
from app.db import Database, dumps_json, utc_now_iso
from app.deps import get_db, get_settings_dep
from app.schemas import HeartbeatRequest, HeartbeatResponse, TaskEnvelope
from app.security import hash_request_body, verify_node_request_signature

router = APIRouter(prefix="/api/node", tags=["node"])


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
    db.prune_expired_nonces(now_iso)

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

        used = conn.execute(
            "SELECT 1 FROM nonces WHERE node_id = ? AND nonce = ?",
            (node_id, nonce),
        ).fetchone()
        if used:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Nonce already used",
            )

        if not verify_node_request_signature(
            node["node_signing_key"],
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
        conn.execute(
            "INSERT INTO nonces (node_id, nonce, timestamp_utc, expires_at) VALUES (?, ?, ?, ?)",
            (node_id, nonce, timestamp, expires_at),
        )

    return node_id, node


@router.post("/heartbeat", response_model=HeartbeatResponse)
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
            SET hostname = ?, heartbeat_interval_sec = ?, last_seen_at = ?, updated_at = ?
            WHERE node_id = ?
            """,
            (
                payload.hostname or node["hostname"],
                payload.heartbeat_interval_sec,
                now_iso,
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
                dumps_json([item.model_dump() for item in payload.gpus]),
                dumps_json(payload.python_env.model_dump()),
                dumps_json(payload.task_runtime.model_dump()),
                dumps_json(payload.model_dump()),
            ),
        )
        claimed_task = db.claim_next_task_for_node(conn, node_id, now_iso)
        tasks = []
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

    db.trim_node_status_history(node_id, settings.max_status_history_per_node)

    return HeartbeatResponse(
        server_time=now_iso,
        node_id=node_id,
        tasks=tasks,
    )

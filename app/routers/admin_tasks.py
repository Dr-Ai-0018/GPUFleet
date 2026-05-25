from __future__ import annotations

import json
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.db import Database, dumps_json, utc_now_iso
from app.deps import get_current_admin, get_db
from app.routers.admin_auth import limiter
from app.schemas import (
    AdminTaskArtifactView,
    AdminTaskCreateRequest,
    AdminTaskDetail,
    AdminTaskListItem,
    AdminTaskLogView,
    AdminTaskResultSummary,
)
from app.task_utils import (
    ACTIVE_TASK_STATUSES,
    TERMINAL_TASK_STATUSES,
    detect_dangerous_command,
    ensure_workdir_allowed,
    normalize_timeout,
)

router = APIRouter(prefix="/api/admin/tasks", tags=["admin-tasks"])

MODAL_ONLY_TASK_TYPES = {"modal_command"}
MODAL_RUNNER_ALLOWED_TASK_TYPES = {"modal_command", "health_check"}


def _task_row_to_list_item(row: object) -> AdminTaskListItem:
    return AdminTaskListItem(
        task_id=row["task_id"],
        revision=row["revision"],
        node_id=row["node_id"],
        type=row["type"],
        status=row["status"],
        workdir=row["workdir"],
        requested_gpu_ids=json.loads(row["requested_gpu_ids_json"]),
        timeout_sec=row["timeout_sec"],
        danger_level=row["danger_level"],
        created_at=row["created_at"],
        claimed_at=row["claimed_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


def _load_log_views(conn: object, task_id: str) -> list[AdminTaskLogView]:
    rows = conn.execute(
        """
        SELECT stream, last_offset, preview_text, center_log_path, updated_at
        FROM task_logs
        WHERE task_id = ?
        ORDER BY stream ASC
        """,
        (task_id,),
    ).fetchall()
    return [
        AdminTaskLogView(
            stream=row["stream"],
            last_offset=row["last_offset"],
            preview_text=row["preview_text"],
            center_log_path=row["center_log_path"],
            updated_at=row["updated_at"],
        )
        for row in rows
    ]


def _load_result_summary(conn: object, task_id: str) -> AdminTaskResultSummary | None:
    row = conn.execute(
        """
        SELECT exit_code, result_summary_json, finished_at
        FROM task_attempts
        WHERE task_id = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (task_id,),
    ).fetchone()
    if row is None:
        return None
    return AdminTaskResultSummary(
        exit_code=row["exit_code"],
        summary=json.loads(row["result_summary_json"]) if row["result_summary_json"] else {},
        finished_at=row["finished_at"],
    )


def _load_artifacts(conn: object, task_id: str) -> list[AdminTaskArtifactView]:
    rows = conn.execute(
        """
        SELECT artifact_name, artifact_type, content_type, size_bytes, storage_path, preview_json, created_at
        FROM artifacts
        WHERE task_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (task_id,),
    ).fetchall()
    return [
        AdminTaskArtifactView(
            artifact_name=row["artifact_name"],
            artifact_type=row["artifact_type"],
            content_type=row["content_type"],
            size_bytes=row["size_bytes"],
            storage_path=row["storage_path"],
            preview=json.loads(row["preview_json"]) if row["preview_json"] else {},
            created_at=row["created_at"],
        )
        for row in rows
    ]


@router.post("", response_model=AdminTaskDetail, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_task(
    payload: AdminTaskCreateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AdminTaskDetail:
    now_iso = utc_now_iso()
    warning_detail_json = dumps_json(payload.model_dump())
    with db.connect() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (payload.node_id,)).fetchone()
        if node is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target node not found")
        if not bool(node["is_enabled"]):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target node is disabled")

        node_type = node["node_type"]
        if payload.type in MODAL_ONLY_TASK_TYPES and node_type != "modal_runner":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="modal_command can only target nodes of type modal_runner",
            )
        if node_type == "modal_runner" and payload.type not in MODAL_RUNNER_ALLOWED_TASK_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="modal_runner nodes only accept modal_command or health_check in phase 1",
            )

        allowed_workdirs = json.loads(node["allowed_workdirs_json"])
        if not ensure_workdir_allowed(payload.workdir, allowed_workdirs):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Task workdir is outside node allowed_workdirs",
            )

        dangerous_match = detect_dangerous_command(payload.type, payload.payload)
        if dangerous_match:
            warning_excerpt = dangerous_match
            warning_source_id = str(admin["id"])
            warning_type = "blocked_dangerous_task_command"
        else:
            warning_excerpt = None
            warning_source_id = None
            warning_type = None

        if warning_excerpt is not None:
            conn.execute(
                """
                INSERT INTO security_warnings (source_type, source_id, warning_type, command_excerpt, detail_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "admin",
                    warning_source_id,
                    warning_type,
                    warning_excerpt,
                    warning_detail_json,
                    now_iso,
                ),
            )
            conn.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Blocked dangerous command snippet: {warning_excerpt}",
            )

        task_id = payload.task_id or f"tsk_{secrets.token_hex(8)}"
        idempotency_key = payload.idempotency_key or f"manual-{secrets.token_hex(12)}"
        timeout_sec = normalize_timeout(payload.type, payload.timeout_sec)

        existing = conn.execute("SELECT 1 FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="task_id already exists")

        conn.execute(
            """
            INSERT INTO tasks (
                task_id, revision, idempotency_key, node_id, type, status, payload_json,
                workdir, env_json, requested_gpu_ids_json, timeout_sec, kill_grace_sec,
                danger_level, created_by_admin_id, created_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                payload.revision,
                idempotency_key,
                payload.node_id,
                payload.type,
                dumps_json(payload.payload),
                payload.workdir,
                dumps_json(payload.env),
                dumps_json(payload.requested_gpu_ids),
                timeout_sec,
                payload.kill_grace_sec,
                payload.danger_level,
                admin["id"],
                now_iso,
            ),
        )
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "create_task",
                "task",
                task_id,
                request.client.host if request.client else None,
                dumps_json(payload.model_dump()),
                now_iso,
            ),
        )
        row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()

    return AdminTaskDetail(
        **_task_row_to_list_item(row).model_dump(),
        idempotency_key=row["idempotency_key"],
        payload=json.loads(row["payload_json"]),
        env=json.loads(row["env_json"]),
        kill_grace_sec=row["kill_grace_sec"],
        logs=[],
        artifacts=[],
        result=None,
    )


@router.get("", response_model=list[AdminTaskListItem])
def list_tasks(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AdminTaskListItem]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [_task_row_to_list_item(row) for row in rows]


@router.get("/{task_id}", response_model=AdminTaskDetail)
def get_task(
    task_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AdminTaskDetail:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

        logs = _load_log_views(conn, task_id)
        artifacts = _load_artifacts(conn, task_id)
        result = _load_result_summary(conn, task_id)

    return AdminTaskDetail(
        **_task_row_to_list_item(row).model_dump(),
        idempotency_key=row["idempotency_key"],
        payload=json.loads(row["payload_json"]),
        env=json.loads(row["env_json"]),
        kill_grace_sec=row["kill_grace_sec"],
        logs=logs,
        artifacts=artifacts,
        result=result,
    )


@router.post("/{task_id}/cancel", response_model=AdminTaskDetail)
@limiter.limit("30/minute")
def cancel_task(
    task_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> AdminTaskDetail:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

        current_status = row["status"]
        if current_status in TERMINAL_TASK_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is already terminal")

        if current_status == "pending":
            new_status = "cancelled"
            finished_at = now_iso
        elif current_status in ACTIVE_TASK_STATUSES:
            new_status = "cancel_requested"
            finished_at = row["finished_at"]
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task cannot be cancelled now")

        conn.execute(
            "UPDATE tasks SET status = ?, finished_at = COALESCE(?, finished_at) WHERE task_id = ?",
            (new_status, finished_at, task_id),
        )
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "cancel_task",
                "task",
                task_id,
                request.client.host if request.client else None,
                dumps_json({"from_status": current_status, "to_status": new_status}),
                now_iso,
            ),
        )
        saved = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        logs = _load_log_views(conn, task_id)
        artifacts = _load_artifacts(conn, task_id)
        result = _load_result_summary(conn, task_id)

    return AdminTaskDetail(
        **_task_row_to_list_item(saved).model_dump(),
        idempotency_key=saved["idempotency_key"],
        payload=json.loads(saved["payload_json"]),
        env=json.loads(saved["env_json"]),
        kill_grace_sec=saved["kill_grace_sec"],
        logs=logs,
        artifacts=artifacts,
        result=result,
    )


@router.get("/{task_id}/logs", response_model=list[AdminTaskLogView])
def get_task_logs(
    task_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> list[AdminTaskLogView]:
    with db.connect() as conn:
        exists = conn.execute("SELECT 1 FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
        return _load_log_views(conn, task_id)


@router.get("/{task_id}/artifacts", response_model=list[AdminTaskArtifactView])
def get_task_artifacts(
    task_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> list[AdminTaskArtifactView]:
    with db.connect() as conn:
        exists = conn.execute("SELECT 1 FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
        return _load_artifacts(conn, task_id)

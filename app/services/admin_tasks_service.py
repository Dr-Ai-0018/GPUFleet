from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
import secrets

from fastapi import Request, status

from app.config import Settings
from app.db import Database, dumps_json, utc_now_iso
from app.errors import ApiError
from app.review import LLMReviewer, ReviewContext
from app.schemas import (
    AdminTaskArtifactView,
    AdminTaskCreateRequest,
    AdminTaskDetail,
    AdminTaskListPage,
    AdminTaskListItem,
    AdminTaskLogView,
    AdminTaskResultSummary,
    ReviewApproveRequest,
    ReviewEscalateRequest,
    ReviewRejectRequest,
)
from app.services.cursor_pagination import add_cursor_filter, add_time_filters, encode_cursor
from app.services.task_state import TaskStateError, get_task_row, transition_task
from app.task_utils import (
    MODAL_TASK_TYPES,
    SHELL_TASK_TYPES,
    TASK_TYPE_LEVEL_L2,
    detect_dangerous_command,
    ensure_workdir_allowed,
    normalize_timeout,
)

MODAL_ONLY_TASK_TYPES = {"modal_command"}
MODAL_RUNNER_ALLOWED_TASK_TYPES = {"modal_command", "health_check"}
HUMAN_REVIEW_COOLDOWN_SEC = 10
REVIEW_TIMEOUT_MINUTES = 30


def task_row_to_list_item(row: object) -> AdminTaskListItem:
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


def load_log_views(conn: object, task_id: str) -> list[AdminTaskLogView]:
    rows = conn.execute(
        """
        SELECT stream, last_offset, preview_text, center_log_path, is_truncated, truncated_notice, updated_at
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
            is_truncated=bool(row["is_truncated"]),
            truncated_notice=row["truncated_notice"] or None,
            updated_at=row["updated_at"],
        )
        for row in rows
    ]


def load_result_summary(conn: object, task_id: str) -> AdminTaskResultSummary | None:
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


def load_artifacts(conn: object, task_id: str) -> list[AdminTaskArtifactView]:
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


def task_row_to_detail(
    conn: object,
    row: object,
    *,
    include_logs: bool = True,
    include_artifacts: bool = True,
    include_result: bool = True,
) -> AdminTaskDetail:
    task_id = row["task_id"]
    logs = load_log_views(conn, task_id) if include_logs else []
    artifacts = load_artifacts(conn, task_id) if include_artifacts else []
    result = load_result_summary(conn, task_id) if include_result else None
    return AdminTaskDetail(
        **task_row_to_list_item(row).model_dump(),
        idempotency_key=row["idempotency_key"],
        payload=json.loads(row["payload_json"]),
        env=json.loads(row["env_json"]),
        kill_grace_sec=row["kill_grace_sec"],
        logs=logs,
        artifacts=artifacts,
        result=result,
        review_stage=row["review_stage"],
        review_decision=row["review_decision"],
    )


def insert_review_audit(
    conn: object,
    *,
    task_id: str,
    stage: int,
    reviewer_type: str,
    reviewer_id: str | None,
    decision: str,
    risk_score: float | None,
    risk_factors_json: str | None,
    reasoning: str | None,
    created_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO task_reviews (task_id, stage, reviewer_type, reviewer_id, decision,
                                  risk_score, risk_factors_json, reasoning, duration_sec, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task_id,
            stage,
            reviewer_type,
            reviewer_id,
            decision,
            risk_score,
            risk_factors_json,
            reasoning,
            None,
            created_at,
        ),
    )
    try:
        from app import metrics as gm

        stage_label = "human" if reviewer_type == "human" or stage == 3 else "llm"
        decision_label = {
            "approve": "approve",
            "reject": "reject",
            "uncertain": "escalate",
            "skipped": "escalate",
            "pending_human": "escalate",
            "human_approved": "approve",
            "human_rejected": "reject",
            "expired": "expired",
        }.get(decision, "escalate")
        gm.REVIEW_DECISION_TOTAL.labels(stage=stage_label, decision=decision_label).inc()
    except Exception:
        pass


def create_review_alert(
    conn: object,
    *,
    task_id: str,
    payload: AdminTaskCreateRequest,
    admin_username: str,
    now_iso: str,
    summary: str,
) -> None:
    alert_detail = {
        "task_id": task_id,
        "task_type": payload.type,
        "node_id": payload.node_id,
        "command": payload.payload.get("command") or payload.payload.get("script", ""),
        "env": payload.env,
        "payload": payload.payload,
        "admin_username": admin_username,
        "dangerous_match": detect_dangerous_command(payload.type, payload.payload),
    }
    expires_at = (datetime.now(UTC) + timedelta(minutes=REVIEW_TIMEOUT_MINUTES)).replace(microsecond=0).isoformat()
    conn.execute(
        """
        INSERT INTO alert_messages (alert_type, severity, title, summary, detail_json,
                                    target_type, target_id, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "command_review",
            "critical",
            f"危险命令审核: {payload.type} @ {payload.node_id}",
            summary,
            dumps_json(alert_detail),
            "task",
            task_id,
            "unread",
            expires_at,
            now_iso,
        ),
    )


def mark_task_alerts_actioned(conn: object, task_id: str, now_iso: str) -> None:
    conn.execute(
        """
        UPDATE alert_messages
        SET status = 'actioned', actioned_at = ?
        WHERE target_type = 'task' AND target_id = ? AND status = 'unread'
        """,
        (now_iso, task_id),
    )


def task_not_found(task_id: str) -> ApiError:
    return ApiError(
        code="ERR_TASK_NOT_FOUND",
        message="Task not found",
        status_code=status.HTTP_404_NOT_FOUND,
        details={"task_id": task_id},
    )


def invalid_task_state(task_id: str, message: str) -> ApiError:
    return ApiError(
        code="ERR_TASK_INVALID_STATE_TRANSITION",
        message=message,
        status_code=status.HTTP_400_BAD_REQUEST,
        details={"task_id": task_id},
    )


async def create_task(
    payload: AdminTaskCreateRequest,
    request: Request,
    admin: object,
    db: Database,
    settings: Settings,
) -> AdminTaskDetail:
    now_iso = utc_now_iso()
    reviewer = LLMReviewer(settings)
    ai_result = None
    with db.connect() as conn:
        node = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (payload.node_id,)).fetchone()
        if node is None:
            raise ApiError(
                code="ERR_TASK_TARGET_NODE_NOT_FOUND",
                message="Target node not found",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"node_id": payload.node_id},
            )
        if not bool(node["is_enabled"]):
            raise ApiError(
                code="ERR_NODE_DISABLED",
                message="Target node is disabled",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"node_id": payload.node_id},
            )

        node_type = node["node_type"]
        if payload.type in MODAL_ONLY_TASK_TYPES and node_type != "modal_runner":
            raise ApiError(
                code="ERR_TASK_INVALID_TARGET_FOR_TYPE",
                message="modal_command can only target nodes of type modal_runner",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"node_id": payload.node_id, "task_type": payload.type, "node_type": node_type},
            )
        if node_type == "modal_runner" and payload.type not in MODAL_RUNNER_ALLOWED_TASK_TYPES:
            raise ApiError(
                code="ERR_TASK_INVALID_TARGET_FOR_TYPE",
                message="modal_runner nodes only accept modal_command or health_check in phase 1",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"node_id": payload.node_id, "task_type": payload.type, "node_type": node_type},
            )

        allowed_workdirs = json.loads(node["allowed_workdirs_json"])
        if not ensure_workdir_allowed(payload.workdir, allowed_workdirs):
            raise ApiError(
                code="ERR_TASK_WORKDIR_NOT_ALLOWED",
                message="Task workdir is outside node allowed_workdirs",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"node_id": payload.node_id, "workdir": payload.workdir},
            )

        is_l2 = payload.type in TASK_TYPE_LEVEL_L2
        initial_status = "pending"
        review_stage = None
        review_decision_val = None
        review_detail_val = None
        review_started_at = None
        review_finished_at = None

        if is_l2:
            if payload.type in SHELL_TASK_TYPES and not node["allow_shell"]:
                raise ApiError(
                    code="ERR_TASK_TYPE_FORBIDDEN_ON_NODE",
                    message=f"Node {payload.node_id} does not allow task type '{payload.type}'. Enable allow_shell first.",
                    status_code=status.HTTP_403_FORBIDDEN,
                    details={"node_id": payload.node_id, "task_type": payload.type, "required_flag": "allow_shell"},
                )
            if payload.type in MODAL_TASK_TYPES and not node["allow_modal"]:
                raise ApiError(
                    code="ERR_TASK_TYPE_FORBIDDEN_ON_NODE",
                    message=f"Node {payload.node_id} does not allow modal_command. Enable allow_modal first.",
                    status_code=status.HTTP_403_FORBIDDEN,
                    details={"node_id": payload.node_id, "task_type": payload.type, "required_flag": "allow_modal"},
                )

            initial_status = "reviewing"
            review_stage = 1
            review_started_at = now_iso

            if reviewer.is_configured:
                legacy_match = detect_dangerous_command(payload.type, payload.payload)
                review_ctx = ReviewContext(
                    task_type=payload.type,
                    node_id=payload.node_id,
                    node_type=node["node_type"],
                    payload=payload.payload,
                    workdir=payload.workdir,
                    env=payload.env,
                    requested_gpu_ids=payload.requested_gpu_ids,
                    admin_username=admin["username"],
                    node_os=node["os_type"],
                    node_tags=json.loads(node["tags_json"]),
                    legacy_blacklist_match=legacy_match,
                )
                ai_result = await reviewer.review(review_ctx)
                review_decision_val = ai_result.decision
                review_detail_val = ai_result.model_dump_json()
                review_finished_at = utc_now_iso()

                if ai_result.decision == "approve":
                    initial_status = "pending"
                    if ai_result.risk_score >= 0.3:
                        payload.danger_level = "elevated"
                else:
                    initial_status = "reviewing"
                    if ai_result.decision == "uncertain":
                        review_stage = 3
            else:
                review_stage = 3
                review_decision_val = "skipped"
                review_detail_val = dumps_json({"reason": "REVIEW_LLM_API_KEY not configured"})

        task_id = payload.task_id or f"tsk_{secrets.token_hex(8)}"
        idempotency_key = payload.idempotency_key or f"manual-{secrets.token_hex(12)}"
        timeout_sec = normalize_timeout(payload.type, payload.timeout_sec)

        existing = conn.execute("SELECT 1 FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if existing:
            raise ApiError(
                code="ERR_TASK_DUPLICATE_ID",
                message="task_id already exists",
                status_code=status.HTTP_409_CONFLICT,
                details={"task_id": task_id},
            )

        conn.execute(
            """
            INSERT INTO tasks (
                task_id, revision, idempotency_key, node_id, type, status, payload_json,
                workdir, env_json, requested_gpu_ids_json, timeout_sec, kill_grace_sec,
                danger_level, created_by_admin_id, created_at,
                review_stage, review_decision, review_detail, review_started_at, review_finished_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                payload.revision,
                idempotency_key,
                payload.node_id,
                payload.type,
                initial_status,
                dumps_json(payload.payload),
                payload.workdir,
                dumps_json(payload.env),
                dumps_json(payload.requested_gpu_ids),
                timeout_sec,
                payload.kill_grace_sec,
                payload.danger_level,
                admin["id"],
                now_iso,
                review_stage,
                review_decision_val,
                review_detail_val,
                review_started_at,
                review_finished_at,
            ),
        )
        if review_stage is not None and review_decision_val:
            insert_review_audit(
                conn,
                task_id=task_id,
                stage=1,
                reviewer_type="llm" if reviewer.is_configured else "skip",
                reviewer_id=settings.review_llm_model if reviewer.is_configured else None,
                decision=review_decision_val,
                risk_score=ai_result.risk_score if ai_result is not None else None,
                risk_factors_json=review_detail_val,
                reasoning=ai_result.reasoning if ai_result is not None else None,
                created_at=now_iso,
            )
        if initial_status == "reviewing":
            create_review_alert(
                conn,
                task_id=task_id,
                payload=payload,
                admin_username=admin["username"],
                now_iso=now_iso,
                summary=f"任务 {task_id} 需要人工审核",
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

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        try:
            from app import metrics as gm

            gm.TASK_CREATED_TOTAL.labels(type=payload.type).inc()
        except Exception:
            pass
        return task_row_to_detail(conn, row, include_logs=False, include_artifacts=False, include_result=False)


def list_tasks(
    db: Database,
    *,
    limit: int,
    cursor: str | None = None,
    node_id: str | None = None,
    status: str | None = None,
    task_type: str | None = None,
    since: str | None = None,
    until: str | None = None,
) -> AdminTaskListPage:
    sql_parts = ["SELECT * FROM tasks WHERE 1=1"]
    count_parts = ["SELECT COUNT(*) AS count FROM tasks WHERE 1=1"]
    params: list[object] = []
    count_params: list[object] = []

    def add_filter(condition: str, value: object) -> None:
        sql_parts.append(condition)
        count_parts.append(condition)
        params.append(value)
        count_params.append(value)

    if node_id:
        add_filter("AND node_id = ?", node_id)
    if status:
        add_filter("AND status = ?", status)
    if task_type:
        add_filter("AND type = ?", task_type)

    add_time_filters(sql_parts, params, since=since, until=until)
    add_time_filters(count_parts, count_params, since=since, until=until)
    add_cursor_filter(sql_parts, params, cursor)

    sql_parts.append("ORDER BY created_at DESC, id DESC")
    sql_parts.append("LIMIT ?")
    params.append(limit + 1)

    with db.connect() as conn:
        rows = conn.execute("\n".join(sql_parts), params).fetchall()
        total_estimate = conn.execute("\n".join(count_parts), count_params).fetchone()["count"]

    page_rows = rows[:limit]
    next_cursor = None
    if len(rows) > limit and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(created_at=last["created_at"], row_id=last["id"])
    return AdminTaskListPage(
        items=[task_row_to_list_item(row) for row in page_rows],
        next_cursor=next_cursor,
        total_estimate=total_estimate,
    )


def get_task(task_id: str, db: Database) -> AdminTaskDetail:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if row is None:
            raise task_not_found(task_id)
        return task_row_to_detail(conn, row)


def cancel_task(task_id: str, request: Request, admin: object, db: Database) -> AdminTaskDetail:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        try:
            row = get_task_row(conn, task_id)
            saved = transition_task(conn, task_id, "cancel", now_iso=now_iso, finished_at=now_iso)
        except TaskStateError as exc:
            if str(exc) == "Task not found":
                raise task_not_found(task_id) from exc
            raise invalid_task_state(task_id, str(exc)) from exc
        current_status = row["status"]
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
                dumps_json({"from_status": current_status, "to_status": saved["status"]}),
                now_iso,
            ),
        )
        return task_row_to_detail(conn, saved)


def escalate_review(task_id: str, payload: ReviewEscalateRequest, request: Request, admin: object, db: Database) -> AdminTaskDetail:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        try:
            row = get_task_row(conn, task_id)
            saved = transition_task(conn, task_id, "review_escalate", now_iso=now_iso)
        except TaskStateError as exc:
            if str(exc) == "Task not found":
                raise task_not_found(task_id) from exc
            raise invalid_task_state(task_id, str(exc)) from exc

        task_payload = AdminTaskCreateRequest(
            node_id=row["node_id"],
            type=row["type"],
            payload=json.loads(row["payload_json"]),
            task_id=row["task_id"],
            revision=row["revision"],
            idempotency_key=row["idempotency_key"],
            workdir=row["workdir"],
            env=json.loads(row["env_json"]),
            requested_gpu_ids=json.loads(row["requested_gpu_ids_json"]),
            timeout_sec=row["timeout_sec"],
            kill_grace_sec=row["kill_grace_sec"],
            danger_level=row["danger_level"],
        )
        create_review_alert(
            conn,
            task_id=task_id,
            payload=task_payload,
            admin_username=admin["username"],
            now_iso=now_iso,
            summary=f"任务 {task_id} 已升级到人工审核",
        )
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "escalate_task_review",
                "task",
                task_id,
                request.client.host if request.client else None,
                dumps_json({"note": payload.note}),
                now_iso,
            ),
        )
        from app.webhook import emit_event
        emit_event(
            "review.escalated",
            {"task_id": task_id, "type": row["type"], "node_id": row["node_id"], "admin": admin["username"]},
            severity="info",
        )
        return task_row_to_detail(conn, saved)


def approve_review(task_id: str, payload: ReviewApproveRequest, request: Request, admin: object, db: Database) -> AdminTaskDetail:
    now = datetime.now(UTC)
    now_iso = now.replace(microsecond=0).isoformat()
    with db.connect() as conn:
        try:
            row = get_task_row(conn, task_id)
        except TaskStateError:
            raise task_not_found(task_id)
        if row["status"] != "reviewing" or row["review_stage"] != 3:
            raise ApiError(
                code="ERR_REVIEW_NOT_PENDING",
                message="Task is not awaiting human approval",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"task_id": task_id, "status": row["status"], "review_stage": row["review_stage"]},
            )

        review_started_at = row["review_started_at"]
        if review_started_at:
            started = datetime.fromisoformat(review_started_at)
            if started.tzinfo is None:
                started = started.replace(tzinfo=UTC)
            if (now - started).total_seconds() < HUMAN_REVIEW_COOLDOWN_SEC:
                raise ApiError(
                    code="ERR_REVIEW_COOLDOWN_NOT_REACHED",
                    message=f"Human review cooldown not reached ({HUMAN_REVIEW_COOLDOWN_SEC}s)",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    details={"task_id": task_id, "retry_after_sec": HUMAN_REVIEW_COOLDOWN_SEC},
                )

        try:
            saved = transition_task(
                conn,
                task_id,
                "review_approve",
                now_iso=now_iso,
                review_admin_id=admin["id"],
                danger_level="human_approved",
            )
        except TaskStateError as exc:
            raise invalid_task_state(task_id, str(exc)) from exc
        insert_review_audit(
            conn,
            task_id=task_id,
            stage=3,
            reviewer_type="human",
            reviewer_id=str(admin["id"]),
            decision="approve",
            risk_score=None,
            risk_factors_json=dumps_json({"note": payload.note}),
            reasoning=payload.note,
            created_at=now_iso,
        )
        mark_task_alerts_actioned(conn, task_id, now_iso)
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "approve_task_review",
                "task",
                task_id,
                request.client.host if request.client else None,
                dumps_json({"note": payload.note}),
                now_iso,
            ),
        )
        return task_row_to_detail(conn, saved)


def reject_review(task_id: str, payload: ReviewRejectRequest, request: Request, admin: object, db: Database) -> AdminTaskDetail:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        try:
            row = get_task_row(conn, task_id)
            saved = transition_task(
                conn,
                task_id,
                "review_reject",
                now_iso=now_iso,
                review_admin_id=admin["id"],
            )
        except TaskStateError as exc:
            if str(exc) == "Task not found":
                raise task_not_found(task_id) from exc
            raise invalid_task_state(task_id, str(exc)) from exc
        insert_review_audit(
            conn,
            task_id=task_id,
            stage=3 if row["review_stage"] == 3 else (row["review_stage"] or 3),
            reviewer_type="human",
            reviewer_id=str(admin["id"]),
            decision="reject",
            risk_score=None,
            risk_factors_json=dumps_json({"note": payload.note}),
            reasoning=payload.note,
            created_at=now_iso,
        )
        mark_task_alerts_actioned(conn, task_id, now_iso)
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "reject_task_review",
                "task",
                task_id,
                request.client.host if request.client else None,
                dumps_json({"note": payload.note}),
                now_iso,
            ),
        )
        return task_row_to_detail(conn, saved)


def get_task_logs(task_id: str, db: Database) -> list[AdminTaskLogView]:
    with db.connect() as conn:
        exists = conn.execute("SELECT 1 FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if exists is None:
            raise task_not_found(task_id)
        return load_log_views(conn, task_id)


def get_task_artifacts(task_id: str, db: Database) -> list[AdminTaskArtifactView]:
    with db.connect() as conn:
        exists = conn.execute("SELECT 1 FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
        if exists is None:
            raise task_not_found(task_id)
        return load_artifacts(conn, task_id)

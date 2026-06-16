from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from fastapi import Request, status

from app.db import Database, dumps_json, utc_now_iso
from app.errors import ApiError
from app.schemas import (
    NodeOnboardingPackage,
    NodeCreateRequest,
    NodeCreateResponse,
    NodeResponse,
    NodeStatusHistoryItem,
    NodeStatusHistoryResponse,
    NodeStatusPreview,
    NodeUpdateRequest,
)
from app.security import derive_node_signing_key, encrypt_node_signing_key, generate_node_secret


def decode_gpu_snapshot(raw_gpu_json: str) -> tuple[list[dict[str, object]], dict[str, object]]:
    parsed = json.loads(raw_gpu_json)
    if isinstance(parsed, list):
        return parsed, {}
    if isinstance(parsed, dict):
        gpus = parsed.get("gpus", [])
        nvidia = parsed.get("nvidia", {})
        return gpus if isinstance(gpus, list) else [], nvidia if isinstance(nvidia, dict) else {}
    return [], {}


def parse_iso_or_none(raw: str | None) -> datetime | None:
    if not raw:
        return None
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def compute_connection_status(
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
    seen_at = parse_iso_or_none(last_seen_at)
    if seen_at is None:
        return "offline"
    if seen_at >= now_utc - timedelta(seconds=heartbeat_interval_sec * 3):
        return "online"
    return "offline"


def compute_onboarding_status(*, is_enabled: bool, first_seen_at: str | None) -> str:
    if not is_enabled:
        return "disabled"
    if not first_seen_at:
        return "awaiting_first_heartbeat"
    return "connected"


def build_onboarding_package(request: Request, payload: NodeCreateRequest, node_secret: str) -> NodeOnboardingPackage:
    control_plane_url = str(request.base_url).rstrip("/")
    mode = "cloud_gpu_runner" if payload.node_type == "modal_runner" else (f"{payload.os_type}_server" if payload.os_type else "auto")
    workdir_lines = "\n".join(payload.allowed_workdirs) if payload.allowed_workdirs else ""
    env_lines = [
        f"GPUFLEET_AGENT_CONTROL_PLANE_URL={control_plane_url}",
        f"GPUFLEET_AGENT_NODE_ID={payload.node_id}",
        f"GPUFLEET_AGENT_NODE_SECRET={node_secret}",
        f"GPUFLEET_AGENT_HEARTBEAT_INTERVAL_SEC={payload.heartbeat_interval_sec}",
        f"GPUFLEET_AGENT_DEPLOYMENT_MODE={mode}",
    ]
    if payload.node_type == "modal_runner":
        env_lines.extend(
            [
                "",
                "GPUFLEET_AGENT_MODAL_CREDENTIALS_PATH=/opt/gpufleet-modal-runner/secrets/modal_credentials.json",
                "GPUFLEET_AGENT_MODAL_DEFAULT_CREDENTIAL_NAME=",
                "GPUFLEET_AGENT_MODAL_DEFAULT_ENVIRONMENT=main",
                "GPUFLEET_AGENT_MODAL_DEFAULT_WORKSPACE=",
            ]
        )
    if workdir_lines:
        env_lines.extend(["", "# Allowed workdirs configured on control plane:", workdir_lines])

    startup_command = "uv run gpufleet-agent heartbeat-loop"
    steps = [
        "1. Copy the env template into the child node host-local .env file.",
        "2. Run uv sync in node_agent/ on the child node host.",
        "3. Start the agent with the startup command below.",
        "4. Wait for the first signed heartbeat so the node flips from awaiting_first_heartbeat to online.",
    ]
    if payload.node_type == "modal_runner":
        steps.insert(
            2,
            "3. Keep real Modal token pairs only in the host-local credential pool JSON, not in this repository.",
        )
    return NodeOnboardingPackage(
        control_plane_url=control_plane_url,
        env_template="\n".join(env_lines).strip(),
        startup_command=startup_command,
        onboarding_steps=steps,
    )


def row_to_node_response(row: object, *, now_utc: datetime | None = None) -> NodeResponse:
    now = now_utc or datetime.now(UTC)
    is_enabled = bool(row["is_enabled"])
    first_seen_at = row["first_seen_at"] if "first_seen_at" in row.keys() else None
    return NodeResponse(
        node_id=row["node_id"],
        display_name=row["display_name"],
        node_type=row["node_type"],
        os_type=row["os_type"],
        hostname=row["hostname"],
        heartbeat_interval_sec=row["heartbeat_interval_sec"],
        allowed_workdirs=json.loads(row["allowed_workdirs_json"]),
        tags=json.loads(row["tags_json"]),
        is_enabled=is_enabled,
        first_seen_at=first_seen_at,
        last_seen_at=row["last_seen_at"],
        connection_status=compute_connection_status(
            is_enabled=is_enabled,
            first_seen_at=first_seen_at,
            last_seen_at=row["last_seen_at"],
            heartbeat_interval_sec=row["heartbeat_interval_sec"],
            now_utc=now,
        ),
        onboarding_status=compute_onboarding_status(is_enabled=is_enabled, first_seen_at=first_seen_at),
        allow_shell=bool(row["allow_shell"]),
        allow_modal=bool(row["allow_modal"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_nodes(db: Database, *, limit: int, offset: int) -> list[NodeResponse]:
    now_utc = datetime.now(UTC)
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM nodes ORDER BY created_at ASC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [row_to_node_response(row, now_utc=now_utc) for row in rows]


def create_node(payload: NodeCreateRequest, request: Request, admin: object, db: Database) -> NodeCreateResponse:
    now_iso = utc_now_iso()
    node_secret = generate_node_secret()
    signing_key = derive_node_signing_key(node_secret)
    encrypted_signing_key = encrypt_node_signing_key(request.app.state.settings, signing_key)

    with db.connect() as conn:
        node_columns = db.get_table_columns(conn, "nodes")
        existing = conn.execute(
            "SELECT 1 FROM nodes WHERE node_id = ?",
            (payload.node_id,),
        ).fetchone()
        if existing:
            raise ApiError(
                code="ERR_NODE_DUPLICATE_ID",
                message="node_id already exists",
                status_code=status.HTTP_409_CONFLICT,
                details={"node_id": payload.node_id},
            )

        if "node_secret_hash" in node_columns:
            conn.execute(
                """
                INSERT INTO nodes (
                    node_id, display_name, node_secret_hash, node_signing_key, encrypted_signing_key, node_type, os_type, hostname,
                    heartbeat_interval_sec, allowed_workdirs_json, tags_json, allow_shell, allow_modal,
                    is_enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    payload.node_id,
                    payload.display_name,
                    None,
                    "",
                    encrypted_signing_key,
                    payload.node_type,
                    payload.os_type,
                    payload.hostname,
                    payload.heartbeat_interval_sec,
                    dumps_json(payload.allowed_workdirs),
                    dumps_json(payload.tags),
                    int(payload.allow_shell),
                    int(payload.allow_modal),
                    now_iso,
                    now_iso,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO nodes (
                    node_id, display_name, node_signing_key, encrypted_signing_key, node_type, os_type, hostname,
                    heartbeat_interval_sec, allowed_workdirs_json, tags_json, allow_shell, allow_modal,
                    is_enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    payload.node_id,
                    payload.display_name,
                    "",
                    encrypted_signing_key,
                    payload.node_type,
                    payload.os_type,
                    payload.hostname,
                    payload.heartbeat_interval_sec,
                    dumps_json(payload.allowed_workdirs),
                    dumps_json(payload.tags),
                    int(payload.allow_shell),
                    int(payload.allow_modal),
                    now_iso,
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
                "create_node",
                "node",
                payload.node_id,
                request.client.host if request.client else None,
                dumps_json(payload.model_dump()),
                now_iso,
            ),
        )
        row = conn.execute(
            "SELECT * FROM nodes WHERE node_id = ?",
            (payload.node_id,),
        ).fetchone()

    base = row_to_node_response(row)
    return NodeCreateResponse(
        **base.model_dump(),
        node_secret=node_secret,
        onboarding=build_onboarding_package(request, payload, node_secret),
    )


def get_node(node_id: str, db: Database) -> NodeResponse:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()

    if row is None:
        raise ApiError(
            code="ERR_NODE_NOT_FOUND",
            message="Node not found",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"node_id": node_id},
        )

    return row_to_node_response(row)


def update_node(node_id: str, payload: NodeUpdateRequest, request: Request, admin: object, db: Database) -> NodeResponse:
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise ApiError(
            code="ERR_NODE_NO_CHANGES",
            message="No changes provided",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"node_id": node_id},
        )

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise ApiError(
                code="ERR_NODE_NOT_FOUND",
                message="Node not found",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"node_id": node_id},
            )

        updated = dict(row)
        if "allowed_workdirs" in changes:
            updated["allowed_workdirs_json"] = dumps_json(changes.pop("allowed_workdirs"))
        if "tags" in changes:
            updated["tags_json"] = dumps_json(changes.pop("tags"))
        if "is_enabled" in changes:
            updated["is_enabled"] = int(changes.pop("is_enabled"))
        if "allow_shell" in changes:
            updated["allow_shell"] = int(changes.pop("allow_shell"))
        if "allow_modal" in changes:
            updated["allow_modal"] = int(changes.pop("allow_modal"))
        updated.update(changes)
        updated["updated_at"] = utc_now_iso()

        conn.execute(
            """
            UPDATE nodes
            SET display_name = ?, os_type = ?, hostname = ?, heartbeat_interval_sec = ?,
                allowed_workdirs_json = ?, tags_json = ?, is_enabled = ?, allow_shell = ?, allow_modal = ?, updated_at = ?
            WHERE node_id = ?
            """,
            (
                updated["display_name"],
                updated["os_type"],
                updated["hostname"],
                updated["heartbeat_interval_sec"],
                updated["allowed_workdirs_json"],
                updated["tags_json"],
                updated["is_enabled"],
                updated["allow_shell"],
                updated["allow_modal"],
                updated["updated_at"],
                node_id,
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
                "update_node",
                "node",
                node_id,
                request.client.host if request.client else None,
                dumps_json(payload.model_dump(exclude_none=True)),
                updated["updated_at"],
            ),
        )
        saved = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()

    return row_to_node_response(saved)


def set_node_enabled(node_id: str, enabled: bool, request: Request, admin: object, db: Database) -> NodeResponse:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise ApiError(
                code="ERR_NODE_NOT_FOUND",
                message="Node not found",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"node_id": node_id},
            )
        conn.execute(
            "UPDATE nodes SET is_enabled = ?, updated_at = ? WHERE node_id = ?",
            (1 if enabled else 0, now_iso, node_id),
        )
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "enable_node" if enabled else "disable_node",
                "node",
                node_id,
                request.client.host if request.client else None,
                dumps_json({"enabled": enabled}),
                now_iso,
            ),
        )
        saved = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
    return row_to_node_response(saved)


def reset_node_secret(node_id: str, request: Request, admin: object, db: Database) -> NodeCreateResponse:
    now_iso = utc_now_iso()
    node_secret = generate_node_secret()
    signing_key = derive_node_signing_key(node_secret)
    encrypted_signing_key = encrypt_node_signing_key(request.app.state.settings, signing_key)

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise ApiError(
                code="ERR_NODE_NOT_FOUND",
                message="Node not found",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"node_id": node_id},
            )

        node_columns = db.get_table_columns(conn, "nodes")
        if "node_secret_hash" in node_columns:
            conn.execute(
                """
                UPDATE nodes
                SET node_secret_hash = ?, node_signing_key = ?, encrypted_signing_key = ?, updated_at = ?
                WHERE node_id = ?
                """,
                (None, "", encrypted_signing_key, now_iso, node_id),
            )
        else:
            conn.execute(
                "UPDATE nodes SET node_signing_key = ?, encrypted_signing_key = ?, updated_at = ? WHERE node_id = ?",
                ("", encrypted_signing_key, now_iso, node_id),
            )
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "reset_node_secret",
                "node",
                node_id,
                request.client.host if request.client else None,
                dumps_json({}),
                now_iso,
            ),
        )
        saved = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()

    from app.schemas import NodeCreateRequest as _NodeCreateRequest

    fake_payload = _NodeCreateRequest(
        node_id=saved["node_id"],
        display_name=saved["display_name"],
        node_type=saved["node_type"],
        os_type=saved["os_type"],
        hostname=saved["hostname"],
        heartbeat_interval_sec=saved["heartbeat_interval_sec"],
        allowed_workdirs=json.loads(saved["allowed_workdirs_json"]),
        tags=json.loads(saved["tags_json"]),
        allow_shell=bool(saved["allow_shell"]),
        allow_modal=bool(saved["allow_modal"]),
    )
    base = row_to_node_response(saved)
    return NodeCreateResponse(
        **base.model_dump(),
        node_secret=node_secret,
        onboarding=build_onboarding_package(request, fake_payload, node_secret),
    )


def delete_node(node_id: str, request: Request, admin: object, db: Database) -> None:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = conn.execute("SELECT 1 FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise ApiError(
                code="ERR_NODE_NOT_FOUND",
                message="Node not found",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"node_id": node_id},
            )
        conn.execute("DELETE FROM nodes WHERE node_id = ?", (node_id,))
        conn.execute(
            """
            INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, request_ip, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                str(admin["id"]),
                "delete_node",
                "node",
                node_id,
                request.client.host if request.client else None,
                dumps_json({}),
                now_iso,
            ),
        )


def get_latest_status(node_id: str, db: Database) -> NodeStatusPreview:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT reported_at, cpu_json, memory_json, disk_json, gpu_json, python_env_json, task_runtime_json, raw_payload_json
            FROM node_status_snapshots
            WHERE node_id = ?
            ORDER BY reported_at DESC, id DESC
            LIMIT 1
            """,
            (node_id,),
        ).fetchone()

    if row is None:
        raise ApiError(
            code="ERR_NODE_STATUS_NOT_FOUND",
            message="No status snapshot found",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"node_id": node_id},
        )

    gpus, nvidia = decode_gpu_snapshot(row["gpu_json"])
    raw_payload = json.loads(row["raw_payload_json"]) if row["raw_payload_json"] else {}

    return NodeStatusPreview(
        reported_at=row["reported_at"],
        cpu=json.loads(row["cpu_json"]),
        memory=json.loads(row["memory_json"]),
        disks=json.loads(row["disk_json"]),
        gpus=gpus,
        nvidia=nvidia,
        python_env=json.loads(row["python_env_json"]),
        task_runtime=json.loads(row["task_runtime_json"]),
        extra=raw_payload.get("extra", {}) if isinstance(raw_payload, dict) else {},
    )


def get_status_history(node_id: str, db: Database, *, limit: int) -> NodeStatusHistoryResponse:
    with db.connect() as conn:
        node_exists = conn.execute("SELECT 1 FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if node_exists is None:
            raise ApiError(
                code="ERR_NODE_NOT_FOUND",
                message="Node not found",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"node_id": node_id},
            )

        rows = conn.execute(
            """
            SELECT reported_at,
                   cpu_usage_percent,
                   memory_usage_percent,
                   gpu_utilization_percent,
                   gpu_memory_percent,
                   gpu_temperature_c,
                   gpu_power_draw_w,
                   gpu_json
            FROM node_status_snapshots
            WHERE node_id = ?
            ORDER BY reported_at DESC, id DESC
            LIMIT ?
            """,
            (node_id, limit),
        ).fetchall()

    items: list[NodeStatusHistoryItem] = []
    for row in reversed(rows):
        gpu_data = json.loads(row["gpu_json"]) if row["gpu_json"] else {}
        gpus_list = gpu_data.get("gpus", []) if isinstance(gpu_data, dict) else (gpu_data if isinstance(gpu_data, list) else [])
        first_gpu = gpus_list[0] if gpus_list else None
        items.append(
            NodeStatusHistoryItem(
                reported_at=row["reported_at"],
                cpu_usage_percent=row["cpu_usage_percent"],
                memory_usage_percent=row["memory_usage_percent"],
                gpu_utilization_percent=row["gpu_utilization_percent"],
                gpu_memory_percent=row["gpu_memory_percent"],
                gpu_temperature_c=row["gpu_temperature_c"],
                gpu_power_draw_w=row["gpu_power_draw_w"],
                gpu_clock_graphics_mhz=first_gpu.get("clock_graphics_mhz") if first_gpu else None,
            )
        )

    return NodeStatusHistoryResponse(node_id=node_id, items=items)

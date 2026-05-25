from __future__ import annotations

import json
from typing import Annotated

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.db import Database, dumps_json, utc_now_iso
from app.deps import get_current_admin, get_db
from app.routers.admin_auth import limiter
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

router = APIRouter(prefix="/api/admin/nodes", tags=["admin-nodes"])


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


def _compute_connection_status(
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


def _build_onboarding_package(request: Request, payload: NodeCreateRequest, node_secret: str) -> NodeOnboardingPackage:
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


def _row_to_node_response(row: object, *, now_utc: datetime | None = None) -> NodeResponse:
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
        connection_status=_compute_connection_status(
            is_enabled=is_enabled,
            first_seen_at=first_seen_at,
            last_seen_at=row["last_seen_at"],
            heartbeat_interval_sec=row["heartbeat_interval_sec"],
            now_utc=now,
        ),
        onboarding_status=_compute_onboarding_status(is_enabled=is_enabled, first_seen_at=first_seen_at),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=list[NodeResponse])
def list_nodes(
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[NodeResponse]:
    now_utc = datetime.now(UTC)
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM nodes ORDER BY created_at ASC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [_row_to_node_response(row, now_utc=now_utc) for row in rows]


@router.post("", response_model=NodeCreateResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_node(
    payload: NodeCreateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeCreateResponse:
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
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="node_id already exists",
            )

        if "node_secret_hash" in node_columns:
            conn.execute(
                """
                INSERT INTO nodes (
                    node_id, display_name, node_secret_hash, node_signing_key, encrypted_signing_key, node_type, os_type, hostname,
                    heartbeat_interval_sec, allowed_workdirs_json, tags_json,
                    is_enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
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
                    now_iso,
                    now_iso,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO nodes (
                    node_id, display_name, node_signing_key, encrypted_signing_key, node_type, os_type, hostname,
                    heartbeat_interval_sec, allowed_workdirs_json, tags_json,
                    is_enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
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

    base = _row_to_node_response(row)
    return NodeCreateResponse(
        **base.model_dump(),
        node_secret=node_secret,
        onboarding=_build_onboarding_package(request, payload, node_secret),
    )


@router.get("/{node_id}", response_model=NodeResponse)
def get_node(
    node_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    return _row_to_node_response(row)


@router.patch("/{node_id}", response_model=NodeResponse)
@limiter.limit("30/minute")
def update_node(
    node_id: str,
    payload: NodeUpdateRequest,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No changes provided")

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

        updated = dict(row)
        if "allowed_workdirs" in changes:
            updated["allowed_workdirs_json"] = dumps_json(changes.pop("allowed_workdirs"))
        if "tags" in changes:
            updated["tags_json"] = dumps_json(changes.pop("tags"))
        if "is_enabled" in changes:
            updated["is_enabled"] = int(changes.pop("is_enabled"))
        updated.update(changes)
        updated["updated_at"] = utc_now_iso()

        conn.execute(
            """
            UPDATE nodes
            SET display_name = ?, os_type = ?, hostname = ?, heartbeat_interval_sec = ?,
                allowed_workdirs_json = ?, tags_json = ?, is_enabled = ?, updated_at = ?
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

    return _row_to_node_response(saved)


@router.post("/{node_id}/disable", response_model=NodeResponse)
@limiter.limit("30/minute")
def disable_node(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    return _set_node_enabled(node_id, False, request, admin, db)


@router.post("/{node_id}/enable", response_model=NodeResponse)
@limiter.limit("30/minute")
def enable_node(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeResponse:
    return _set_node_enabled(node_id, True, request, admin, db)


def _set_node_enabled(
    node_id: str,
    enabled: bool,
    request: Request,
    admin: object,
    db: Database,
) -> NodeResponse:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
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
    return _row_to_node_response(saved)


@router.post("/{node_id}/reset-secret", response_model=NodeCreateResponse)
@limiter.limit("30/minute")
def reset_node_secret(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeCreateResponse:
    now_iso = utc_now_iso()
    node_secret = generate_node_secret()
    signing_key = derive_node_signing_key(node_secret)
    encrypted_signing_key = encrypt_node_signing_key(request.app.state.settings, signing_key)

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

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

    # Re-build onboarding package using saved node data
    from app.schemas import NodeCreateRequest as _NCR
    fake_payload = _NCR(
        node_id=saved["node_id"],
        display_name=saved["display_name"],
        node_type=saved["node_type"],
        os_type=saved["os_type"],
        hostname=saved["hostname"],
        heartbeat_interval_sec=saved["heartbeat_interval_sec"],
        allowed_workdirs=json.loads(saved["allowed_workdirs_json"]),
        tags=json.loads(saved["tags_json"]),
    )
    base = _row_to_node_response(saved)
    return NodeCreateResponse(
        **base.model_dump(),
        node_secret=node_secret,
        onboarding=_build_onboarding_package(request, fake_payload, node_secret),
    )


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_node(
    node_id: str,
    request: Request,
    admin: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> None:
    now_iso = utc_now_iso()
    with db.connect() as conn:
        row = conn.execute("SELECT 1 FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
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


@router.get("/{node_id}/status/latest", response_model=NodeStatusPreview)
def get_latest_status(
    node_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
) -> NodeStatusPreview:
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No status snapshot found")

    gpus, nvidia = _decode_gpu_snapshot(row["gpu_json"])
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


@router.get("/{node_id}/status/history", response_model=NodeStatusHistoryResponse)
def get_status_history(
    node_id: str,
    _: Annotated[object, Depends(get_current_admin)],
    db: Annotated[Database, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 60,
) -> NodeStatusHistoryResponse:
    with db.connect() as conn:
        node_exists = conn.execute("SELECT 1 FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if node_exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

        rows = conn.execute(
            """
            SELECT reported_at, cpu_json, memory_json, gpu_json
            FROM node_status_snapshots
            WHERE node_id = ?
            ORDER BY reported_at DESC, id DESC
            LIMIT ?
            """,
            (node_id, limit),
        ).fetchall()

    items = []
    for row in reversed(rows):  # reverse to ascending order
        cpu = json.loads(row["cpu_json"])
        memory = json.loads(row["memory_json"])
        gpu_data = json.loads(row["gpu_json"])
        # gpu_json is stored as {"gpus": [...], "nvidia": {...}}
        gpus_list = gpu_data.get("gpus", []) if isinstance(gpu_data, dict) else (gpu_data if isinstance(gpu_data, list) else [])
        first_gpu = gpus_list[0] if gpus_list else None
        items.append(
            NodeStatusHistoryItem(
                reported_at=row["reported_at"],
                cpu_usage_percent=cpu.get("usage_percent"),
                memory_usage_percent=memory.get("usage_percent"),
                gpu_utilization_percent=first_gpu.get("utilization_percent") if first_gpu else None,
                gpu_memory_percent=(
                    (float(first_gpu.get("used_vram_mb", 0)) / float(first_gpu.get("total_vram_mb", 1))) * 100
                    if first_gpu and first_gpu.get("total_vram_mb")
                    else None
                ),
                gpu_temperature_c=first_gpu.get("temperature_c") if first_gpu else None,
                gpu_power_draw_w=first_gpu.get("power_draw_w") if first_gpu else None,
                gpu_clock_graphics_mhz=first_gpu.get("clock_graphics_mhz") if first_gpu else None,
            )
        )

    return NodeStatusHistoryResponse(node_id=node_id, items=items)

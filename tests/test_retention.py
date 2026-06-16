"""Tests for background retention cleanup jobs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.background import _prune_old_artifacts, _prune_old_status_snapshots, _prune_old_task_logs
from app.config import get_settings
from app.db import Database, dumps_json


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "retention-node") -> None:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Retention Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "allow_shell": True,
        },
    )
    assert resp.status_code == 201, resp.text


def _create_terminal_task(client: TestClient, auth_headers: dict[str, str], node_id: str = "retention-node") -> str:
    resp = client.post(
        "/api/v1/admin/tasks",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "type": "health_check",
            "payload": {},
            "workdir": "/tmp/work",
        },
    )
    assert resp.status_code == 201, resp.text
    task_id = resp.json()["task_id"]
    db = Database(get_settings().database_path)
    finished_at = (datetime.now(UTC) - timedelta(days=31)).replace(microsecond=0).isoformat()
    with db.connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = 'succeeded', finished_at = ? WHERE task_id = ?",
            (finished_at, task_id),
        )
    return task_id


def test_prune_old_status_snapshots_keeps_recent_rows(client: TestClient, auth_headers: dict[str, str]) -> None:
    _create_node(client, auth_headers)
    settings = get_settings()
    db = Database(settings.database_path)
    old_time = (datetime.now(UTC) - timedelta(days=settings.snapshot_retention_days + 1)).replace(microsecond=0).isoformat()
    fresh_time = datetime.now(UTC).replace(microsecond=0).isoformat()

    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO node_status_snapshots (
                node_id, reported_at, cpu_usage_percent, memory_usage_percent,
                gpu_utilization_percent, gpu_memory_percent, gpu_temperature_c, gpu_power_draw_w,
                cpu_json, memory_json, disk_json, gpu_json, python_env_json, task_runtime_json, raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "retention-node",
                old_time,
                10.0,
                20.0,
                30.0,
                40.0,
                50.0,
                60.0,
                "{}",
                "{}",
                "[]",
                "{}",
                "{}",
                "{}",
                "{}",
            ),
        )
        conn.execute(
            """
            INSERT INTO node_status_snapshots (
                node_id, reported_at, cpu_usage_percent, memory_usage_percent,
                gpu_utilization_percent, gpu_memory_percent, gpu_temperature_c, gpu_power_draw_w,
                cpu_json, memory_json, disk_json, gpu_json, python_env_json, task_runtime_json, raw_payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "retention-node",
                fresh_time,
                11.0,
                21.0,
                31.0,
                41.0,
                51.0,
                61.0,
                "{}",
                "{}",
                "[]",
                "{}",
                "{}",
                "{}",
                "{}",
            ),
        )

    _prune_old_status_snapshots(db)

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT reported_at FROM node_status_snapshots WHERE node_id = ? ORDER BY reported_at ASC",
            ("retention-node",),
        ).fetchall()

    assert [row["reported_at"] for row in rows] == [fresh_time]


def test_prune_old_task_logs_deletes_file_and_metadata(client: TestClient, auth_headers: dict[str, str]) -> None:
    _create_node(client, auth_headers)
    task_id = _create_terminal_task(client, auth_headers)
    settings = get_settings()
    db = Database(settings.database_path)
    log_dir = settings.storage_path / "logs" / task_id
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "stdout.log"
    log_path.write_text("hello log", encoding="utf-8")

    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO task_logs (task_id, stream, last_offset, preview_text, center_log_path, updated_at)
            VALUES (?, 'stdout', ?, ?, ?, ?)
            """,
            (
                task_id,
                len("hello log"),
                "hello log",
                str(log_path),
                datetime.now(UTC).replace(microsecond=0).isoformat(),
            ),
        )

    _prune_old_task_logs(db)

    assert not log_path.exists()
    with db.connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS count FROM task_logs WHERE task_id = ?", (task_id,)).fetchone()["count"]
    assert count == 0


def test_prune_old_artifacts_deletes_file_and_metadata(client: TestClient, auth_headers: dict[str, str]) -> None:
    _create_node(client, auth_headers)
    task_id = _create_terminal_task(client, auth_headers)
    settings = get_settings()
    db = Database(settings.database_path)
    artifact_dir = settings.storage_path / "artifacts" / task_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_dir / "output.txt"
    artifact_path.write_text("artifact payload", encoding="utf-8")

    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO artifacts (
                task_id, artifact_name, artifact_type, content_type, size_bytes,
                storage_path, preview_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                "output.txt",
                "file",
                "text/plain",
                len("artifact payload"),
                str(artifact_path),
                dumps_json({}),
                datetime.now(UTC).replace(microsecond=0).isoformat(),
            ),
        )

    _prune_old_artifacts(db)

    assert not artifact_path.exists()
    with db.connect() as conn:
        count = conn.execute("SELECT COUNT(*) AS count FROM artifacts WHERE task_id = ?", (task_id,)).fetchone()["count"]
    assert count == 0

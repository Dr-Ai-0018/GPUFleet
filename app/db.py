from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

from app.config import get_settings
from app.security import encrypt_node_signing_key


def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def dumps_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


class Database:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        settings = get_settings()
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute(f"PRAGMA busy_timeout = {settings.sqlite_busy_timeout_ms}")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS admins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT,
                    tokens_invalidated_at TEXT
                );

                CREATE TABLE IF NOT EXISTS nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    node_signing_key TEXT,
                    encrypted_signing_key TEXT,
                    node_type TEXT NOT NULL,
                    os_type TEXT,
                    hostname TEXT,
                    heartbeat_interval_sec INTEGER NOT NULL DEFAULT 5,
                    allowed_workdirs_json TEXT NOT NULL DEFAULT '[]',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    allow_shell INTEGER NOT NULL DEFAULT 0,
                    allow_modal INTEGER NOT NULL DEFAULT 0,
                    is_enabled INTEGER NOT NULL DEFAULT 1,
                    first_seen_at TEXT,
                    last_seen_at TEXT,
                    last_request_ts TEXT,
                    last_boot_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS node_status_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    reported_at TEXT NOT NULL,
                    cpu_usage_percent REAL,
                    memory_usage_percent REAL,
                    gpu_utilization_percent REAL,
                    gpu_memory_percent REAL,
                    gpu_temperature_c REAL,
                    gpu_power_draw_w REAL,
                    cpu_json TEXT NOT NULL,
                    memory_json TEXT NOT NULL,
                    disk_json TEXT NOT NULL,
                    gpu_json TEXT NOT NULL,
                    python_env_json TEXT NOT NULL,
                    task_runtime_json TEXT NOT NULL,
                    raw_payload_json TEXT NOT NULL,
                    FOREIGN KEY(node_id) REFERENCES nodes(node_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL UNIQUE,
                    revision INTEGER NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    workdir TEXT,
                    env_json TEXT NOT NULL DEFAULT '{}',
                    requested_gpu_ids_json TEXT NOT NULL DEFAULT '[]',
                    timeout_sec INTEGER NOT NULL DEFAULT 3600,
                    kill_grace_sec INTEGER NOT NULL DEFAULT 15,
                    danger_level TEXT NOT NULL DEFAULT 'normal',
                    created_by_admin_id INTEGER,
                    created_at TEXT NOT NULL,
                    claimed_at TEXT,
                    started_at TEXT,
                    finished_at TEXT,
                    result_locked_at TEXT,
                    review_stage INTEGER,
                    review_decision TEXT,
                    review_detail TEXT,
                    review_admin_id INTEGER,
                    review_started_at TEXT,
                    review_finished_at TEXT,
                    FOREIGN KEY(node_id) REFERENCES nodes(node_id) ON DELETE CASCADE,
                    FOREIGN KEY(created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS task_attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    agent_boot_id TEXT,
                    pid INTEGER,
                    pgid_or_job_id TEXT,
                    status TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    exit_code INTEGER,
                    result_summary_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
                    FOREIGN KEY(node_id) REFERENCES nodes(node_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS task_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    stream TEXT NOT NULL,
                    last_offset INTEGER NOT NULL DEFAULT 0,
                    preview_text TEXT NOT NULL DEFAULT '',
                    center_log_path TEXT,
                    is_truncated INTEGER NOT NULL DEFAULT 0,
                    truncated_notice TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL,
                    UNIQUE(task_id, stream),
                    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    artifact_name TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    content_type TEXT,
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    storage_path TEXT NOT NULL,
                    preview_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    actor_type TEXT NOT NULL,
                    actor_id TEXT,
                    action TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    target_id TEXT,
                    request_ip TEXT,
                    detail_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS security_warnings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_type TEXT NOT NULL,
                    source_id TEXT,
                    warning_type TEXT NOT NULL,
                    command_excerpt TEXT,
                    detail_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS nonces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    nonce TEXT NOT NULL,
                    timestamp_utc TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    UNIQUE(node_id, nonce),
                    FOREIGN KEY(node_id) REFERENCES nodes(node_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS task_reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    stage INTEGER NOT NULL,
                    reviewer_type TEXT NOT NULL,
                    reviewer_id TEXT,
                    decision TEXT NOT NULL,
                    risk_score REAL,
                    risk_factors_json TEXT,
                    reasoning TEXT,
                    duration_sec REAL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS alert_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alert_type TEXT NOT NULL,
                    severity TEXT NOT NULL DEFAULT 'warning',
                    title TEXT NOT NULL,
                    summary TEXT,
                    detail_json TEXT,
                    target_type TEXT,
                    target_id TEXT,
                    status TEXT NOT NULL DEFAULT 'unread',
                    actioned_by INTEGER,
                    actioned_at TEXT,
                    expires_at TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_nodes_last_seen_at ON nodes(last_seen_at);
                CREATE INDEX IF NOT EXISTS idx_snapshots_node_id_reported_at ON node_status_snapshots(node_id, reported_at DESC);
                CREATE INDEX IF NOT EXISTS idx_tasks_node_status_created_at ON tasks(node_id, status, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_task_attempts_task_id_id ON task_attempts(task_id, id DESC);
                CREATE INDEX IF NOT EXISTS idx_nonces_node_id_expires_at ON nonces(node_id, expires_at);
                CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
                CREATE INDEX IF NOT EXISTS idx_task_reviews_task_id ON task_reviews(task_id);
                CREATE INDEX IF NOT EXISTS idx_alert_messages_status_created ON alert_messages(status, created_at DESC);
                """
            )
            self._migrate_schema(conn)

    def _migrate_schema(self, conn: sqlite3.Connection) -> None:
        node_columns = {
            row["name"]: row
            for row in conn.execute("PRAGMA table_info(nodes)").fetchall()
        }

        if "node_signing_key" not in node_columns:
            conn.execute("ALTER TABLE nodes ADD COLUMN node_signing_key TEXT")
        if "encrypted_signing_key" not in node_columns:
            conn.execute("ALTER TABLE nodes ADD COLUMN encrypted_signing_key TEXT")
        if "first_seen_at" not in node_columns:
            conn.execute("ALTER TABLE nodes ADD COLUMN first_seen_at TEXT")
        if "last_request_ts" not in node_columns:
            conn.execute("ALTER TABLE nodes ADD COLUMN last_request_ts TEXT")
        if "last_boot_id" not in node_columns:
            conn.execute("ALTER TABLE nodes ADD COLUMN last_boot_id TEXT")
        if "allow_shell" not in node_columns:
            conn.execute("ALTER TABLE nodes ADD COLUMN allow_shell INTEGER NOT NULL DEFAULT 0")
        if "allow_modal" not in node_columns:
            conn.execute("ALTER TABLE nodes ADD COLUMN allow_modal INTEGER NOT NULL DEFAULT 0")
        settings = get_settings()
        select_columns = ["id", "node_signing_key", "encrypted_signing_key"]
        if "node_secret_hash" in node_columns:
            select_columns.append("node_secret_hash")
        rows = conn.execute(f"SELECT {', '.join(select_columns)} FROM nodes").fetchall()
        for row in rows:
            legacy_signing_key = row["node_secret_hash"] if "node_secret_hash" in row.keys() else ""
            plaintext_signing_key = row["node_signing_key"] or legacy_signing_key or ""
            encrypted_signing_key = row["encrypted_signing_key"] or ""
            if plaintext_signing_key and not encrypted_signing_key:
                encrypted_signing_key = encrypt_node_signing_key(settings, plaintext_signing_key)
            if plaintext_signing_key != "" or encrypted_signing_key != row["encrypted_signing_key"]:
                conn.execute(
                    """
                    UPDATE nodes
                    SET node_signing_key = ?, encrypted_signing_key = ?
                    WHERE id = ?
                    """,
                    (
                        "",
                        encrypted_signing_key,
                        row["id"],
                    ),
                )

        task_columns = {
            row["name"]: row
            for row in conn.execute("PRAGMA table_info(tasks)").fetchall()
        }
        if "result_locked_at" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN result_locked_at TEXT")
        if "review_stage" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN review_stage INTEGER")
        if "review_decision" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN review_decision TEXT")
        if "review_detail" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN review_detail TEXT")
        if "review_admin_id" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN review_admin_id INTEGER")
        if "review_started_at" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN review_started_at TEXT")
        if "review_finished_at" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN review_finished_at TEXT")

        snapshot_columns = {
            row["name"]: row
            for row in conn.execute("PRAGMA table_info(node_status_snapshots)").fetchall()
        }
        if "cpu_usage_percent" not in snapshot_columns:
            conn.execute("ALTER TABLE node_status_snapshots ADD COLUMN cpu_usage_percent REAL")
        if "memory_usage_percent" not in snapshot_columns:
            conn.execute("ALTER TABLE node_status_snapshots ADD COLUMN memory_usage_percent REAL")
        if "gpu_utilization_percent" not in snapshot_columns:
            conn.execute("ALTER TABLE node_status_snapshots ADD COLUMN gpu_utilization_percent REAL")
        if "gpu_memory_percent" not in snapshot_columns:
            conn.execute("ALTER TABLE node_status_snapshots ADD COLUMN gpu_memory_percent REAL")
        if "gpu_temperature_c" not in snapshot_columns:
            conn.execute("ALTER TABLE node_status_snapshots ADD COLUMN gpu_temperature_c REAL")
        if "gpu_power_draw_w" not in snapshot_columns:
            conn.execute("ALTER TABLE node_status_snapshots ADD COLUMN gpu_power_draw_w REAL")
        conn.execute(
            """
            UPDATE node_status_snapshots
            SET cpu_usage_percent = COALESCE(cpu_usage_percent, CAST(json_extract(cpu_json, '$.usage_percent') AS REAL)),
                memory_usage_percent = COALESCE(memory_usage_percent, CAST(json_extract(memory_json, '$.usage_percent') AS REAL)),
                gpu_utilization_percent = COALESCE(gpu_utilization_percent, CAST(json_extract(gpu_json, '$.gpus[0].utilization_percent') AS REAL)),
                gpu_memory_percent = COALESCE(
                    gpu_memory_percent,
                    CASE
                        WHEN CAST(json_extract(gpu_json, '$.gpus[0].total_vram_mb') AS REAL) > 0
                        THEN CAST(json_extract(gpu_json, '$.gpus[0].used_vram_mb') AS REAL) * 100.0
                             / CAST(json_extract(gpu_json, '$.gpus[0].total_vram_mb') AS REAL)
                        ELSE NULL
                    END
                ),
                gpu_temperature_c = COALESCE(gpu_temperature_c, CAST(json_extract(gpu_json, '$.gpus[0].temperature_c') AS REAL)),
                gpu_power_draw_w = COALESCE(gpu_power_draw_w, CAST(json_extract(gpu_json, '$.gpus[0].power_draw_w') AS REAL))
            """
        )

        admin_columns = {
            row["name"]: row
            for row in conn.execute("PRAGMA table_info(admins)").fetchall()
        }
        if "tokens_invalidated_at" not in admin_columns:
            conn.execute("ALTER TABLE admins ADD COLUMN tokens_invalidated_at TEXT")

        task_log_columns = {
            row["name"]: row
            for row in conn.execute("PRAGMA table_info(task_logs)").fetchall()
        }
        if "is_truncated" not in task_log_columns:
            conn.execute("ALTER TABLE task_logs ADD COLUMN is_truncated INTEGER NOT NULL DEFAULT 0")
        if "truncated_notice" not in task_log_columns:
            conn.execute("ALTER TABLE task_logs ADD COLUMN truncated_notice TEXT NOT NULL DEFAULT ''")

    def trim_node_status_history(self, node_id: str, keep: int) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                DELETE FROM node_status_snapshots
                WHERE node_id = ?
                  AND id NOT IN (
                    SELECT id
                    FROM node_status_snapshots
                    WHERE node_id = ?
                    ORDER BY reported_at DESC, id DESC
                    LIMIT ?
                  )
                """,
                (node_id, node_id, keep),
            )

    def prune_expired_nonces(self, now_iso: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM nonces WHERE expires_at < ?", (now_iso,))

    @staticmethod
    def get_table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
        return {
            row["name"]
            for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        }

    def claim_next_task_for_node(self, conn: sqlite3.Connection, node_id: str, claimed_at: str) -> sqlite3.Row | None:
        updated = conn.execute(
            """
            UPDATE tasks
            SET status = 'claimed', claimed_at = ?
            WHERE task_id = (
                SELECT t.task_id
                FROM tasks t
                WHERE t.node_id = ?
                  AND t.status = 'pending'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM tasks t2
                      WHERE t2.node_id = ?
                        AND t2.status IN ('claimed', 'running', 'cancel_requested')
                  )
                ORDER BY t.created_at ASC, t.id ASC
                LIMIT 1
            )
              AND status = 'pending'
            RETURNING *
            """,
            (claimed_at, node_id, node_id),
        )
        return updated.fetchone()

    def sync_reported_active_task(
        self,
        conn: sqlite3.Connection,
        node_id: str,
        active_task_id: str | None,
        claimed_at: str,
    ) -> sqlite3.Row | None:
        if not active_task_id:
            return None
        row = conn.execute(
            "SELECT * FROM tasks WHERE node_id = ? AND task_id = ?",
            (node_id, active_task_id),
        ).fetchone()
        if row is None:
            return None
        if row["status"] == "pending":
            conn.execute(
                """
                UPDATE tasks
                SET status = 'claimed', claimed_at = COALESCE(claimed_at, ?)
                WHERE task_id = ?
                """,
                (claimed_at, active_task_id),
            )
            row = conn.execute(
                "SELECT * FROM tasks WHERE node_id = ? AND task_id = ?",
                (node_id, active_task_id),
            ).fetchone()
        return row

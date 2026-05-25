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
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
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
                    last_login_at TEXT
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
                    is_enabled INTEGER NOT NULL DEFAULT 1,
                    first_seen_at TEXT,
                    last_seen_at TEXT,
                    last_boot_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS node_status_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    reported_at TEXT NOT NULL,
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

                CREATE INDEX IF NOT EXISTS idx_nodes_last_seen_at ON nodes(last_seen_at);
                CREATE INDEX IF NOT EXISTS idx_snapshots_node_id_reported_at ON node_status_snapshots(node_id, reported_at DESC);
                CREATE INDEX IF NOT EXISTS idx_tasks_node_status_created_at ON tasks(node_id, status, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_task_attempts_task_id_id ON task_attempts(task_id, id DESC);
                CREATE INDEX IF NOT EXISTS idx_nonces_node_id_expires_at ON nonces(node_id, expires_at);
                CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
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
        if "last_boot_id" not in node_columns:
            conn.execute("ALTER TABLE nodes ADD COLUMN last_boot_id TEXT")
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
        active_task = conn.execute(
            """
            SELECT 1
            FROM tasks
            WHERE node_id = ? AND status IN ('claimed', 'running', 'cancel_requested')
            LIMIT 1
            """,
            (node_id,),
        ).fetchone()
        if active_task:
            return None

        pending = conn.execute(
            """
            SELECT task_id
            FROM tasks
            WHERE node_id = ? AND status = 'pending'
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            """,
            (node_id,),
        ).fetchone()
        if pending is None:
            return None

        updated = conn.execute(
            """
            UPDATE tasks
            SET status = 'claimed', claimed_at = ?
            WHERE task_id = ? AND status = 'pending'
            """,
            (claimed_at, pending["task_id"]),
        )
        if updated.rowcount != 1:
            return None

        return conn.execute(
            "SELECT * FROM tasks WHERE task_id = ?",
            (pending["task_id"],),
        ).fetchone()

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

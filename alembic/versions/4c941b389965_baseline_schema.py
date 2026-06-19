"""baseline schema

Revision ID: 4c941b389965
Revises:
Create Date: 2026-05-26 02:27:57.723817
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "4c941b389965"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SCHEMA_SQL = """
CREATE TABLE admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT,
    tokens_invalidated_at TEXT
);

CREATE TABLE nodes (
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

CREATE TABLE node_status_snapshots (
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

CREATE TABLE tasks (
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

CREATE TABLE task_attempts (
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

CREATE TABLE task_logs (
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

CREATE TABLE artifacts (
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

CREATE TABLE audit_events (
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

CREATE TABLE security_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    source_id TEXT,
    warning_type TEXT NOT NULL,
    command_excerpt TEXT,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE nonces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    nonce TEXT NOT NULL,
    timestamp_utc TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE(node_id, nonce),
    FOREIGN KEY(node_id) REFERENCES nodes(node_id) ON DELETE CASCADE
);

CREATE TABLE task_reviews (
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

CREATE TABLE alert_messages (
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

CREATE INDEX idx_nodes_last_seen_at ON nodes(last_seen_at);
CREATE INDEX idx_snapshots_node_id_reported_at ON node_status_snapshots(node_id, reported_at DESC);
CREATE INDEX idx_tasks_node_status_created_at ON tasks(node_id, status, created_at DESC);
CREATE INDEX idx_task_attempts_task_id_id ON task_attempts(task_id, id DESC);
CREATE INDEX idx_nonces_node_id_expires_at ON nonces(node_id, expires_at);
CREATE INDEX idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX idx_task_reviews_task_id ON task_reviews(task_id);
CREATE INDEX idx_alert_messages_status_created ON alert_messages(status, created_at DESC);
"""


DROP_SQL = """
DROP TABLE IF EXISTS alert_messages;
DROP TABLE IF EXISTS task_reviews;
DROP TABLE IF EXISTS nonces;
DROP TABLE IF EXISTS security_warnings;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS task_logs;
DROP TABLE IF EXISTS task_attempts;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS node_status_snapshots;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS admins;
"""


def _executescript(sql: str) -> None:
    bind = op.get_bind()
    raw_connection = bind.connection.driver_connection
    raw_connection.executescript(sql)


def upgrade() -> None:
    """Upgrade schema."""
    _executescript(SCHEMA_SQL)


def downgrade() -> None:
    """Downgrade schema."""
    _executescript(DROP_SQL)

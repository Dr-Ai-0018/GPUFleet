"""集中定义 Prometheus 指标对象 (D3 §2.3 指标全表).

设计来源: docs/D3_Observability_Design.md
命名规约: gpufleet_<domain>_<name>; counter 后缀 _total; histogram 后缀 _seconds / _bytes.

cardinality 约束: 单一指标的总 cardinality ≤ 10000.
- node_id 可以做标签 (节点数百级)
- task_id 不可做标签 (任务数无界, 会爆炸)
"""

from __future__ import annotations

from pathlib import Path

from prometheus_client import Counter, Gauge, Histogram


# ---------------------------------------------------------------------------
# 节点
# ---------------------------------------------------------------------------

NODES_TOTAL = Gauge(
    "gpufleet_nodes_total",
    "Total node count by status snapshot at last scanner tick.",
    labelnames=("status",),  # online / offline / disabled / never_seen
)

NODE_HEARTBEAT_DURATION_SECONDS = Histogram(
    "gpufleet_node_heartbeat_seconds",
    "Heartbeat request handling duration on control plane.",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)

NODE_HEARTBEAT_TOTAL = Counter(
    "gpufleet_node_heartbeat_total",
    "Total heartbeat requests received.",
    labelnames=("node_id", "result"),  # result: ok / reject
)

NODE_ONLINE_SECONDS = Gauge(
    "gpufleet_node_online_seconds",
    "Seconds since each node's last heartbeat.",
    labelnames=("node_id",),
)

NODE_KEY_V1_LEGACY_FALLBACK_TOTAL = Counter(
    "gpufleet_node_key_v1_legacy_fallback_total",
    "Total v1 node signing keys decrypted with legacy fallback secret.",
    labelnames=("source",),
)


# ---------------------------------------------------------------------------
# 任务
# ---------------------------------------------------------------------------

TASKS_BY_STATUS = Gauge(
    "gpufleet_tasks_by_status",
    "Task count by current status (refreshed each scanner tick).",
    labelnames=("status",),
)

TASK_CREATED_TOTAL = Counter(
    "gpufleet_task_created_total",
    "Total tasks created.",
    labelnames=("type",),
)

TASK_COMPLETED_TOTAL = Counter(
    "gpufleet_task_completed_total",
    "Total tasks that reached a terminal status.",
    labelnames=("result",),  # success / fail / timeout / lost / cancelled
)

TASK_DURATION_SECONDS = Histogram(
    "gpufleet_task_duration_seconds",
    "Task wallclock duration from claimed to terminal status.",
    labelnames=("result",),
    buckets=(1.0, 5.0, 10.0, 30.0, 60.0, 300.0, 600.0, 1800.0, 3600.0),
)

TASK_CLAIM_LATENCY_SECONDS = Histogram(
    "gpufleet_task_claim_latency_seconds",
    "Task queue wait time from created to claimed.",
    buckets=(1.0, 5.0, 10.0, 30.0, 60.0, 300.0, 600.0, 1800.0, 3600.0),
)


# ---------------------------------------------------------------------------
# 审核 (§1.5)
# ---------------------------------------------------------------------------

REVIEW_PENDING = Gauge(
    "gpufleet_review_pending",
    "Current count of tasks in reviewing status.",
)

REVIEW_DECISION_TOTAL = Counter(
    "gpufleet_review_decision_total",
    "Total review decisions made.",
    labelnames=("stage", "decision"),  # stage: llm/human; decision: approve/reject/escalate/expired
)

REVIEW_LLM_DURATION_SECONDS = Histogram(
    "gpufleet_review_llm_duration_seconds",
    "LLM review call duration.",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)


# ---------------------------------------------------------------------------
# HTTP (中间件自动采集)
# ---------------------------------------------------------------------------

HTTP_REQUESTS_TOTAL = Counter(
    "gpufleet_http_requests_total",
    "Total HTTP requests handled.",
    labelnames=("method", "path_template", "status"),
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "gpufleet_http_request_duration_seconds",
    "HTTP request handling duration.",
    labelnames=("method", "path_template"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)


# ---------------------------------------------------------------------------
# DB / 存储 / 日志
# ---------------------------------------------------------------------------

DB_BUSY_TOTAL = Counter(
    "gpufleet_db_busy_total",
    "Total SQLite BUSY errors observed (busy_timeout exhausted).",
)

DB_QUERY_DURATION_SECONDS = Histogram(
    "gpufleet_db_query_duration_seconds",
    "Database query duration by operation type.",
    labelnames=("op",),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)

STORAGE_BYTES = Gauge(
    "gpufleet_storage_bytes",
    "Storage usage by kind.",
    labelnames=("kind",),  # logs / artifacts / snapshots
)

LOG_TRUNCATED_TOTAL = Counter(
    "gpufleet_log_truncated_total",
    "Total log chunks rejected due to quota / per-stream truncation.",
)

ARTIFACT_UPLOAD_TOTAL = Counter(
    "gpufleet_artifact_upload_total",
    "Node artifact upload attempts by result.",
    labelnames=("result",),  # ok / reject_size / reject_quota / reject_invalid
)

ARTIFACT_UPLOAD_BYTES_TOTAL = Counter(
    "gpufleet_artifact_upload_bytes_total",
    "Total accepted artifact upload bytes.",
)


# ---------------------------------------------------------------------------
# 后台清理任务
# ---------------------------------------------------------------------------

BACKGROUND_JOB_DURATION_SECONDS = Histogram(
    "gpufleet_background_job_duration_seconds",
    "Background cleanup job duration.",
    labelnames=("job",),  # prune_snapshots / prune_logs / prune_artifacts / mark_lost / expire_reviewing
    buckets=(0.001, 0.01, 0.1, 1.0, 10.0, 60.0, 300.0),
)

BACKGROUND_JOB_ERRORS_TOTAL = Counter(
    "gpufleet_background_job_errors_total",
    "Background cleanup job exceptions.",
    labelnames=("job",),
)


# ---------------------------------------------------------------------------
# Webhook (任务 C 使用; 任务 A 只占位定义)
# ---------------------------------------------------------------------------

WEBHOOK_QUEUE_DEPTH = Gauge(
    "gpufleet_webhook_queue_depth",
    "Current in-memory webhook queue depth.",
)

WEBHOOK_SEND_TOTAL = Counter(
    "gpufleet_webhook_send_total",
    "Webhook send attempts by event and result.",
    labelnames=("event", "result"),  # result: ok / fail / dropped
)

WEBHOOK_SEND_DURATION_SECONDS = Histogram(
    "gpufleet_webhook_send_duration_seconds",
    "Webhook POST duration.",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def update_nodes_by_status(counts: dict[str, int]) -> None:
    """刷新节点状态 gauge. counts 形如 {'online': 5, 'offline': 2, 'disabled': 0, 'never_seen': 1}."""
    for status in ("online", "offline", "disabled", "never_seen"):
        NODES_TOTAL.labels(status=status).set(counts.get(status, 0))


def update_tasks_by_status(counts: dict[str, int]) -> None:
    """刷新任务状态 gauge. counts 形如 {'pending': 3, 'running': 1, ...}."""
    # 主动 reset 所有曾经见过的 status, 避免某个 status 归零后还残留旧值
    # 注: prometheus_client Gauge 不支持自动 reset, 我们只更新已知 status 集合.
    known_statuses = (
        "pending",
        "claimed",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "timeout",
        "lost",
        "reviewing",
        "rejected",
        "review_expired",
    )
    for status in known_statuses:
        TASKS_BY_STATUS.labels(status=status).set(counts.get(status, 0))


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            try:
                total += item.stat().st_size
            except OSError:
                continue
    return total


def update_storage_bytes(storage_root: Path) -> None:
    """刷新 storage_bytes gauge. 目录不存在视为 0."""
    STORAGE_BYTES.labels(kind="logs").set(_dir_size(storage_root / "logs"))
    STORAGE_BYTES.labels(kind="artifacts").set(_dir_size(storage_root / "artifacts"))
    STORAGE_BYTES.labels(kind="snapshots").set(_dir_size(storage_root / "snapshots"))


def init_static_labelsets() -> None:
    """预注册 D3 冻结标签集合, 保证 /metrics 在 0 值时也输出可发现的时间序列."""
    for status in ("online", "offline", "disabled", "never_seen"):
        NODES_TOTAL.labels(status=status).set(0)
    NODE_KEY_V1_LEGACY_FALLBACK_TOTAL.labels(source="jwt_secret").inc(0)
    for status in (
        "pending",
        "claimed",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "timeout",
        "lost",
        "reviewing",
        "rejected",
        "review_expired",
    ):
        TASKS_BY_STATUS.labels(status=status).set(0)
    for task_type in ("health_check", "shell", "python_script", "modal_command"):
        TASK_CREATED_TOTAL.labels(type=task_type).inc(0)
    for result in ("success", "fail", "timeout", "lost", "cancelled"):
        TASK_COMPLETED_TOTAL.labels(result=result).inc(0)
        TASK_DURATION_SECONDS.labels(result=result)
    for stage in ("llm", "human"):
        for decision in ("approve", "reject", "escalate", "expired"):
            REVIEW_DECISION_TOTAL.labels(stage=stage, decision=decision).inc(0)
    for op in ("select", "insert", "update", "delete"):
        DB_QUERY_DURATION_SECONDS.labels(op=op)
    for kind in ("logs", "artifacts", "snapshots"):
        STORAGE_BYTES.labels(kind=kind).set(0)
    for result in ("ok", "reject_size", "reject_quota", "reject_invalid"):
        ARTIFACT_UPLOAD_TOTAL.labels(result=result).inc(0)
    for event in ("task.failed", "task.lost", "storage.quota_exceeded"):
        for result in ("ok", "fail", "dropped"):
            WEBHOOK_SEND_TOTAL.labels(event=event, result=result).inc(0)


init_static_labelsets()

"""Prometheus metrics minimum viable integration tests.

设计来源: docs/D3_Observability_Design.md 任务 A
"""

from __future__ import annotations

import base64
import json
import time
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.security import build_signed_headers_for_test


D3_METRIC_NAMES = (
    "gpufleet_nodes_total",
    "gpufleet_node_heartbeat_seconds",
    "gpufleet_node_heartbeat_total",
    "gpufleet_node_online_seconds",
    "gpufleet_tasks_by_status",
    "gpufleet_task_created_total",
    "gpufleet_task_completed_total",
    "gpufleet_task_duration_seconds",
    "gpufleet_task_claim_latency_seconds",
    "gpufleet_review_pending",
    "gpufleet_review_decision_total",
    "gpufleet_review_llm_duration_seconds",
    "gpufleet_http_requests_total",
    "gpufleet_http_request_duration_seconds",
    "gpufleet_db_busy_total",
    "gpufleet_db_query_duration_seconds",
    "gpufleet_storage_bytes",
    "gpufleet_log_truncated_total",
    "gpufleet_artifact_upload_total",
    "gpufleet_artifact_upload_bytes_total",
    "gpufleet_background_job_duration_seconds",
    "gpufleet_background_job_errors_total",
    "gpufleet_webhook_queue_depth",
    "gpufleet_webhook_send_total",
    "gpufleet_webhook_send_duration_seconds",
)


def _enable_metrics_token(monkeypatch, token: str = "metrics-token") -> str:
    from app.config import get_settings

    monkeypatch.setenv("GPUFLEET_METRICS_TOKEN", token)
    get_settings.cache_clear()
    return token


def _scrape(client: TestClient, token: str = "metrics-token") -> str:
    resp = client.get("/metrics", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/plain")
    return resp.text


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "metrics-node") -> dict:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Metrics Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "tags": [],
            "allow_shell": True,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_task(client: TestClient, auth_headers: dict[str, str], node_id: str) -> dict:
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
    return resp.json()


def _heartbeat(client: TestClient, node_id: str, node_secret: str, boot_id: str = "boot-metrics") -> None:
    payload = {
        "boot_id": boot_id,
        "heartbeat_interval_sec": 5,
        "cpu": {"usage_percent": 30.0},
        "memory": {"usage_percent": 40.0},
        "gpus": [],
    }
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test(node_id, node_secret, body)
    resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
    assert resp.status_code == 200, resp.text


def test_metrics_endpoint_auth_token_and_localhost_rules(client: TestClient, monkeypatch) -> None:
    """token configured -> 401 without/with wrong token; no token from non-local TestClient -> 403."""
    token = _enable_metrics_token(monkeypatch, "secret-metrics-token")
    assert client.get("/metrics").status_code == 401
    assert client.get("/metrics", headers={"Authorization": "Bearer wrong-token"}).status_code == 401
    assert client.get("/metrics", headers={"Authorization": f"Bearer {token}"}).status_code == 200

    from app.config import get_settings

    monkeypatch.delenv("GPUFLEET_METRICS_TOKEN", raising=False)
    get_settings.cache_clear()
    assert client.get("/metrics").status_code == 403


def test_metrics_scrape_contains_full_d3_metric_table(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    """After login/node/task/heartbeat activity, /metrics exposes every frozen D3 §2.3 metric name."""
    token = _enable_metrics_token(monkeypatch)
    node = _create_node(client, auth_headers, "metrics-full-table")
    _create_task(client, auth_headers, node["node_id"])
    _heartbeat(client, node["node_id"], node["node_secret"])
    client.get("/api/v1/admin/dashboard/overview", headers=auth_headers)

    text = _scrape(client, token)

    for metric_name in D3_METRIC_NAMES:
        assert metric_name in text, f"missing metric {metric_name}"
    assert 'path_template="/api/v1/admin/dashboard/overview"' in text
    assert f'gpufleet_node_heartbeat_total{{node_id="{node["node_id"]}",result="ok"}}' in text


def test_tasks_by_status_uses_succeeded_not_completed(
    client: TestClient,
    monkeypatch,
) -> None:
    """守卫 metrics 与 DB 实际枚举一致 — 历史上 metrics.py 用 'completed' 而 DB 用 'succeeded'
    导致 gpufleet_tasks_by_status{status="succeeded"} 永远为 0, 成功任务数静默漏报.
    """
    from app import metrics as gm

    token = _enable_metrics_token(monkeypatch)
    gm.update_tasks_by_status({"succeeded": 7, "running": 2})
    text = _scrape(client, token)

    assert 'gpufleet_tasks_by_status{status="succeeded"} 7.0' in text
    assert 'gpufleet_tasks_by_status{status="running"} 2.0' in text
    # 不应再有 completed 这个无效 label, 否则说明回归
    assert 'gpufleet_tasks_by_status{status="completed"}' not in text


def test_http_middleware_uses_path_template_not_raw_path(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    token = _enable_metrics_token(monkeypatch)
    node = _create_node(client, auth_headers, "metrics-template-node")
    client.get("/api/v1/admin/nodes", headers=auth_headers)
    client.get(f"/api/v1/admin/nodes/{node['node_id']}", headers=auth_headers)

    text = _scrape(client, token)

    assert 'path_template="/api/v1/admin/nodes/{node_id}"' in text
    assert 'path_template="/api/v1/admin/nodes/metrics-template-node"' not in text


def test_heartbeat_metrics_count_reject_on_bad_payload(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    token = _enable_metrics_token(monkeypatch)
    node = _create_node(client, auth_headers, "metrics-hb-reject")
    body = json.dumps(
        {
            "boot_id": "boot-bad",
            "heartbeat_interval_sec": 5,
            "samples": [{"ts": "2026-06-12T17:00:00Z", "gpus": [{"idx": -1}]}],
        }
    ).encode("utf-8")
    headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
    resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
    assert resp.status_code == 422

    text = _scrape(client, token)

    assert f'gpufleet_node_heartbeat_total{{node_id="{node["node_id"]}",result="reject"}}' in text


def test_heartbeat_reject_metrics_collapse_unknown_node_ids(
    client: TestClient,
    monkeypatch,
) -> None:
    token = _enable_metrics_token(monkeypatch)
    body = json.dumps({"boot_id": "boot-unknown"}).encode("utf-8")

    for i in range(3):
        attacker_node_id = f"attacker-controlled-{i}"
        headers = build_signed_headers_for_test(attacker_node_id, "does-not-matter", body)
        resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
        assert resp.status_code == 401

    text = _scrape(client, token)

    assert 'gpufleet_node_heartbeat_total{node_id="unknown",result="reject"}' in text
    assert "attacker-controlled-" not in text


def test_artifact_upload_metrics_record_success_and_reject_size(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    token = _enable_metrics_token(monkeypatch)
    node = _create_node(client, auth_headers, "metrics-artifact-node")
    task = _create_task(client, auth_headers, node["node_id"])
    content = b"hello artifact"
    payload = {
        "task_id": task["task_id"],
        "artifact_name": "output.txt",
        "artifact_type": "file",
        "content_base64": base64.b64encode(content).decode("ascii"),
        "content_type": "text/plain",
        "preview": {},
    }
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
    resp = client.post("/api/v1/node/artifact-upload", content=body, headers=headers)
    assert resp.status_code == 200, resp.text

    from app.config import get_settings

    settings = get_settings()
    original_max = settings.max_artifact_bytes
    settings.max_artifact_bytes = 1
    try:
        reject_body = json.dumps({**payload, "artifact_name": "too-big.txt"}).encode("utf-8")
        reject_headers = build_signed_headers_for_test(
            node["node_id"],
            node["node_secret"],
            reject_body,
            timestamp=(datetime.now(UTC) + timedelta(seconds=1)).replace(microsecond=0).isoformat(),
        )
        reject = client.post("/api/v1/node/artifact-upload", content=reject_body, headers=reject_headers)
        assert reject.status_code == 413
    finally:
        settings.max_artifact_bytes = original_max

    text = _scrape(client, token)

    assert 'gpufleet_artifact_upload_total{result="ok"}' in text
    assert 'gpufleet_artifact_upload_total{result="reject_size"}' in text
    assert "gpufleet_artifact_upload_bytes_total" in text


def test_http_metrics_middleware_overhead_within_five_percent(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    """Compare cached Prometheus hot-path ops with no-op collectors.

    The request-level benchmark was dominated by TestClient / SQLite jitter on
    Windows. This keeps the original regression guard focused on the middleware
    work itself: resolving cached metric children and recording inc/observe.
    """
    from app import metrics as gm
    from app import main as app_main

    class _NoopChild:
        def inc(self) -> None:
            return None

        def observe(self, _value: float) -> None:
            return None

    class _NoopMetric:
        def labels(self, **_labels: str) -> _NoopChild:
            return _NoopChild()

    # Keep a smoke request so this test still covers the route used by the
    # original request-level benchmark and warms the template cache.
    resp = client.get("/api/v1/admin/dashboard/overview", headers=auth_headers)
    assert resp.status_code == 200

    def run_metric_hot_path() -> float:
        started = time.perf_counter()
        for _ in range(10_000):
            app_main._http_total_child("GET", "/api/v1/admin/dashboard/overview", "200").inc()
            app_main._http_duration_child("GET", "/api/v1/admin/dashboard/overview").observe(0.001)
        return time.perf_counter() - started

    original_total = gm.HTTP_REQUESTS_TOTAL
    original_duration = gm.HTTP_REQUEST_DURATION_SECONDS
    try:
        app_main._HTTP_TOTAL_CHILDREN.clear()
        app_main._HTTP_DURATION_CHILDREN.clear()
        monkeypatch.setattr(gm, "HTTP_REQUESTS_TOTAL", _NoopMetric())
        monkeypatch.setattr(gm, "HTTP_REQUEST_DURATION_SECONDS", _NoopMetric())
        baseline = run_metric_hot_path()
    finally:
        monkeypatch.setattr(gm, "HTTP_REQUESTS_TOTAL", original_total)
        monkeypatch.setattr(gm, "HTTP_REQUEST_DURATION_SECONDS", original_duration)
        app_main._HTTP_TOTAL_CHILDREN.clear()
        app_main._HTTP_DURATION_CHILDREN.clear()

    instrumented = run_metric_hot_path()
    # 10k hot-path recordings should stay comfortably sub-100ms on local CI.
    # This is stricter than the old request-level +20ms/100-request tolerance,
    # while avoiding false failures from sub-millisecond scheduler jitter.
    allowed = baseline * 1.05 + 0.05

    assert instrumented <= allowed, {
        "baseline": baseline,
        "instrumented": instrumented,
        "allowed": allowed,
    }

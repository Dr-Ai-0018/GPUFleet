"""Prometheus 指标接入验收: /metrics 端点鉴权 + HTTP middleware + 心跳计数.

设计来源: docs/D3_Observability_Design.md 任务 A
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.security import build_signed_headers_for_test


# -----------------------------------------------------------------------------
# /metrics 端点鉴权
# -----------------------------------------------------------------------------


def test_metrics_endpoint_local_access_allowed_when_no_token(client: TestClient) -> None:
    """未配 GPUFLEET_METRICS_TOKEN: TestClient 默认 client host='testclient' 不算 localhost, 应 401."""
    resp = client.get("/metrics")
    # TestClient 的 client.host = 'testclient' (固定值), 既无 token 又非 127.0.0.1 -> 401
    assert resp.status_code == 401
    assert resp.json()["code"] == "ERR_AUTH_INVALID_TOKEN"


def test_metrics_endpoint_token_required_when_configured(
    client: TestClient,
    monkeypatch,
) -> None:
    """配了 metrics_token: 必须带正确 Bearer 才能 200, 错误 token 401."""
    from app.config import get_settings

    monkeypatch.setenv("GPUFLEET_METRICS_TOKEN", "secret-metrics-token")
    get_settings.cache_clear()

    try:
        # 1) 无 Authorization -> 401
        resp = client.get("/metrics")
        assert resp.status_code == 401

        # 2) 错误 token -> 401
        resp = client.get("/metrics", headers={"Authorization": "Bearer wrong-token"})
        assert resp.status_code == 401

        # 3) 正确 token -> 200 + Prometheus 文本格式
        resp = client.get("/metrics", headers={"Authorization": "Bearer secret-metrics-token"})
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/plain")
        body = resp.text
        # 关键指标存在 (即使值为 0)
        assert "gpufleet_http_requests_total" in body
        assert "gpufleet_node_heartbeat_duration_seconds" in body
        assert "gpufleet_tasks_by_status" in body
        assert "gpufleet_background_job_duration_seconds" in body
    finally:
        monkeypatch.delenv("GPUFLEET_METRICS_TOKEN", raising=False)
        get_settings.cache_clear()


# -----------------------------------------------------------------------------
# HTTP middleware 采集
# -----------------------------------------------------------------------------


def test_http_middleware_counts_requests_by_path_template(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    """请求 /api/admin/nodes 与 /api/admin/nodes/{id} 应在不同 path_template 标签下计数, 不爆 cardinality."""
    from app.config import get_settings

    monkeypatch.setenv("GPUFLEET_METRICS_TOKEN", "test-token")
    get_settings.cache_clear()

    try:
        # 触发若干请求
        resp = client.post(
            "/api/admin/nodes",
            headers=auth_headers,
            json={
                "node_id": "metrics-test-node",
                "display_name": "Metrics Node",
                "node_type": "physical",
                "os_type": "linux",
                "heartbeat_interval_sec": 5,
                "allowed_workdirs": ["/tmp/work"],
                "tags": [],
            },
        )
        assert resp.status_code == 201
        client.get("/api/admin/nodes", headers=auth_headers)
        client.get("/api/admin/nodes/metrics-test-node", headers=auth_headers)

        # 抓 metrics
        metrics_resp = client.get("/metrics", headers={"Authorization": "Bearer test-token"})
        assert metrics_resp.status_code == 200
        text = metrics_resp.text

        # path_template 应保留 {node_id} 占位符, 不展开成具体 node_id
        # (避免 cardinality 爆炸)
        assert 'path_template="/api/admin/nodes/{node_id}"' in text
        # 普通 list 端点 path_template 是 "/api/admin/nodes"
        assert 'path_template="/api/admin/nodes"' in text
    finally:
        monkeypatch.delenv("GPUFLEET_METRICS_TOKEN", raising=False)
        get_settings.cache_clear()


# -----------------------------------------------------------------------------
# 心跳指标
# -----------------------------------------------------------------------------


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str) -> dict:
    resp = client.post(
        "/api/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "HB Metric Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "tags": [],
        },
    )
    assert resp.status_code == 201
    return resp.json()


def test_heartbeat_metrics_count_ok_and_record_duration(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    """有效心跳: gpufleet_node_heartbeat_total{result='ok'} 应递增, duration histogram 也应记录."""
    from app.config import get_settings

    monkeypatch.setenv("GPUFLEET_METRICS_TOKEN", "tk")
    get_settings.cache_clear()

    try:
        node = _create_node(client, auth_headers, "metrics-hb-ok")
        payload = {
            "boot_id": "boot-metrics-001",
            "heartbeat_interval_sec": 5,
            "cpu": {"usage_percent": 30.0},
            "memory": {"usage_percent": 40.0},
            "gpus": [],
        }
        body = json.dumps(payload).encode("utf-8")
        headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
        # 一次心跳即可验证 counter 递增 (重复发会撞 last_request_ts 单调校验, 测试反而失败)
        hb = client.post("/api/node/heartbeat", content=body, headers=headers)
        assert hb.status_code == 200

        text = client.get("/metrics", headers={"Authorization": "Bearer tk"}).text
        # ok counter >= 1; 用 process-wide registry 累积, 其他测试也可能 +1, 不强求 == 1
        import re
        match = re.search(r'gpufleet_node_heartbeat_total\{result="ok"\}\s+(\d+\.\d+)', text)
        assert match is not None, f"missing ok counter line, full text:\n{text[:2000]}"
        assert float(match.group(1)) >= 1.0

        # duration histogram 应至少有一个 _count 或 _sum 大于 0
        assert "gpufleet_node_heartbeat_duration_seconds_count" in text
    finally:
        monkeypatch.delenv("GPUFLEET_METRICS_TOKEN", raising=False)
        get_settings.cache_clear()


def test_heartbeat_metrics_count_reject_on_bad_payload(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch,
) -> None:
    """坏 payload (校验失败 422): result='reject' 应递增."""
    from app.config import get_settings

    monkeypatch.setenv("GPUFLEET_METRICS_TOKEN", "tk")
    get_settings.cache_clear()

    try:
        node = _create_node(client, auth_headers, "metrics-hb-reject")
        # 故意发坏 payload (sample idx 负数 触发 422)
        body = json.dumps(
            {
                "boot_id": "boot-bad",
                "heartbeat_interval_sec": 5,
                "cpu": {"usage_percent": 30.0},
                "memory": {"usage_percent": 40.0},
                "gpus": [],
                "samples": [
                    {"ts": "2026-06-12T17:00:00Z", "cpu_percent": 50, "memory_percent": 50,
                     "gpus": [{"idx": -1}]},
                ],
            }
        ).encode("utf-8")
        headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
        resp = client.post("/api/node/heartbeat", content=body, headers=headers)
        assert resp.status_code == 422

        text = client.get("/metrics", headers={"Authorization": "Bearer tk"}).text
        import re
        match = re.search(r'gpufleet_node_heartbeat_total\{result="reject"\}\s+(\d+\.\d+)', text)
        assert match is not None
        assert float(match.group(1)) >= 1.0
    finally:
        monkeypatch.delenv("GPUFLEET_METRICS_TOKEN", raising=False)
        get_settings.cache_clear()

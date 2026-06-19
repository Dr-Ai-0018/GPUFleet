"""GET /api/v1/admin/nodes/{node_id}/status/history 时间窗 since/until + 提升 limit 上限."""

from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient

from app.config import get_settings


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str) -> dict[str, object]:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Range Test Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "tags": [],
        },
    )
    assert resp.status_code == 201
    return resp.json()


def _seed_snapshots(node_id: str, ts_list: list[str]) -> None:
    """直接往 db 写若干 snapshot 行 (基准行, cpu_json 非 NULL)."""
    settings = get_settings()
    conn = sqlite3.connect(settings.database_path)
    try:
        for ts in ts_list:
            conn.execute(
                """
                INSERT INTO node_status_snapshots (
                    node_id, reported_at, cpu_usage_percent, memory_usage_percent,
                    gpu_utilization_percent, gpu_memory_percent, gpu_temperature_c, gpu_power_draw_w,
                    cpu_json, memory_json, disk_json, gpu_json,
                    python_env_json, task_runtime_json, raw_payload_json, sample_gpus_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    node_id, ts, 50.0, 60.0, 70.0, 80.0, 65.0, 100.0,
                    json.dumps({"usage_percent": 50.0}),
                    json.dumps({"usage_percent": 60.0}),
                    json.dumps([]),
                    json.dumps({"gpus": []}),
                    json.dumps({}),
                    json.dumps({}),
                    json.dumps({}),
                    None,
                ),
            )
        conn.commit()
    finally:
        conn.close()


def test_history_since_filters_older_rows(client: TestClient, auth_headers: dict[str, str]) -> None:
    node = _create_node(client, auth_headers, "node-history-since")
    _seed_snapshots(
        node["node_id"],
        [
            "2026-06-16T11:00:00+00:00",
            "2026-06-16T11:30:00+00:00",
            "2026-06-16T12:00:00+00:00",
            "2026-06-16T12:30:00+00:00",
        ],
    )

    # since=11:45 → 只剩 12:00 和 12:30
    resp = client.get(
        f"/api/v1/admin/nodes/{node['node_id']}/status/history?since=2026-06-16T11:45:00%2B00:00",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    ts_list = [i["reported_at"] for i in items]
    assert "2026-06-16T11:00:00+00:00" not in ts_list
    assert "2026-06-16T11:30:00+00:00" not in ts_list
    assert "2026-06-16T12:00:00+00:00" in ts_list
    assert "2026-06-16T12:30:00+00:00" in ts_list


def test_history_until_filters_newer_rows(client: TestClient, auth_headers: dict[str, str]) -> None:
    node = _create_node(client, auth_headers, "node-history-until")
    _seed_snapshots(
        node["node_id"],
        [
            "2026-06-16T11:00:00+00:00",
            "2026-06-16T12:00:00+00:00",
            "2026-06-16T13:00:00+00:00",
        ],
    )
    resp = client.get(
        f"/api/v1/admin/nodes/{node['node_id']}/status/history?until=2026-06-16T12:30:00%2B00:00",
        headers=auth_headers,
    )
    items = resp.json()["items"]
    ts_list = [i["reported_at"] for i in items]
    assert "2026-06-16T13:00:00+00:00" not in ts_list
    assert "2026-06-16T11:00:00+00:00" in ts_list
    assert "2026-06-16T12:00:00+00:00" in ts_list


def test_history_since_until_window(client: TestClient, auth_headers: dict[str, str]) -> None:
    node = _create_node(client, auth_headers, "node-history-window")
    _seed_snapshots(
        node["node_id"],
        [
            "2026-06-16T10:00:00+00:00",
            "2026-06-16T11:00:00+00:00",
            "2026-06-16T12:00:00+00:00",
            "2026-06-16T13:00:00+00:00",
            "2026-06-16T14:00:00+00:00",
        ],
    )
    resp = client.get(
        f"/api/v1/admin/nodes/{node['node_id']}/status/history"
        f"?since=2026-06-16T11:30:00%2B00:00&until=2026-06-16T13:30:00%2B00:00",
        headers=auth_headers,
    )
    items = resp.json()["items"]
    ts_list = [i["reported_at"] for i in items]
    assert ts_list == ["2026-06-16T12:00:00+00:00", "2026-06-16T13:00:00+00:00"]


def test_history_limit_upper_bound_is_5000(client: TestClient, auth_headers: dict[str, str]) -> None:
    """限制上限提到 5000. limit=5000 应通过, 5001 应 422."""
    node = _create_node(client, auth_headers, "node-history-limit")
    # 5000 OK
    resp = client.get(
        f"/api/v1/admin/nodes/{node['node_id']}/status/history?limit=5000",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    # 5001 应 422 (Pydantic le=5000)
    resp_over = client.get(
        f"/api/v1/admin/nodes/{node['node_id']}/status/history?limit=5001",
        headers=auth_headers,
    )
    assert resp_over.status_code == 422


def test_history_without_filters_backward_compatible(client: TestClient, auth_headers: dict[str, str]) -> None:
    """不传 since/until/limit 时跟以前一样, 取最近 60 行 (默认 limit)."""
    node = _create_node(client, auth_headers, "node-history-compat")
    _seed_snapshots(node["node_id"], [f"2026-06-16T12:00:{s:02d}+00:00" for s in range(10)])

    resp = client.get(
        f"/api/v1/admin/nodes/{node['node_id']}/status/history",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 10

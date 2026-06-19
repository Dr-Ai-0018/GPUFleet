"""Tests for hot metric columns on node status snapshots."""

from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient

from app.config import get_settings
from app.security import build_signed_headers_for_test


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "hot-columns-node") -> dict[str, object]:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Hot Columns Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "tags": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_heartbeat_persists_hot_metric_columns_and_history_reads_them(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    node = _create_node(client, auth_headers)
    payload = {
        "boot_id": "boot-hot-001",
        "heartbeat_interval_sec": 5,
        "cpu": {"usage_percent": 41.5},
        "memory": {"usage_percent": 66.2},
        "gpus": [
            {
                "index": 0,
                "used_vram_mb": 12288,
                "total_vram_mb": 24576,
                "utilization_percent": 77.5,
                "temperature_c": 69.0,
                "power_draw_w": 241.0,
                "clock_graphics_mhz": 1845,
            }
        ],
    }
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)

    heartbeat_resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
    assert heartbeat_resp.status_code == 200, heartbeat_resp.text

    settings = get_settings()
    with sqlite3.connect(settings.database_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT cpu_usage_percent, memory_usage_percent, gpu_utilization_percent,
                   gpu_memory_percent, gpu_temperature_c, gpu_power_draw_w
            FROM node_status_snapshots
            WHERE node_id = ?
            ORDER BY reported_at DESC, id DESC
            LIMIT 1
            """,
            (node["node_id"],),
        ).fetchone()

    assert row is not None
    assert row["cpu_usage_percent"] == 41.5
    assert row["memory_usage_percent"] == 66.2
    assert row["gpu_utilization_percent"] == 77.5
    assert row["gpu_memory_percent"] == 50.0
    assert row["gpu_temperature_c"] == 69.0
    assert row["gpu_power_draw_w"] == 241.0

    history_resp = client.get(f"/api/v1/admin/nodes/{node['node_id']}/status/history", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    item = history_resp.json()["items"][-1]
    assert item["cpu_usage_percent"] == 41.5
    assert item["memory_usage_percent"] == 66.2
    assert item["gpu_utilization_percent"] == 77.5
    assert item["gpu_memory_percent"] == 50.0
    assert item["gpu_temperature_c"] == 69.0
    assert item["gpu_power_draw_w"] == 241.0
    assert item["gpu_clock_graphics_mhz"] == 1845

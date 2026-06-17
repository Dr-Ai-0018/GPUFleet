"""节点高密采样: 1s 本地采集 + 5s 心跳批量上传, 服务端 batch INSERT 验收测试.

设计来源: docs/Heartbeat_HighDensity_Sampling_Design.md (本地, 已冻结)
"""

from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient

from app.config import get_settings
from app.security import build_signed_headers_for_test


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str) -> dict[str, object]:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Sampling Test Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "tags": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _send_heartbeat(
    client: TestClient,
    node: dict[str, object],
    payload: dict[str, object],
) -> None:
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
    resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
    assert resp.status_code == 200, resp.text


def _snapshot_rows(node_id: str) -> list[sqlite3.Row]:
    settings = get_settings()
    with sqlite3.connect(settings.database_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT reported_at, cpu_usage_percent, memory_usage_percent,
                   gpu_utilization_percent, gpu_memory_percent, gpu_temperature_c, gpu_power_draw_w,
                   cpu_json, memory_json, gpu_json, raw_payload_json, sample_gpus_json
            FROM node_status_snapshots
            WHERE node_id = ?
            ORDER BY reported_at ASC, id ASC
            """,
            (node_id,),
        ).fetchall()
    return rows


def test_empty_samples_falls_back_to_single_row(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """旧 agent 不带 samples -> 写入 1 行, JSON 元数据齐全, sample_gpus_json 装当前 GPUs."""
    node = _create_node(client, auth_headers, "node-empty-samples")
    _send_heartbeat(
        client,
        node,
        {
            "boot_id": "boot-001",
            "heartbeat_interval_sec": 5,
            "cpu": {"usage_percent": 42.0},
            "memory": {"usage_percent": 50.0},
            "gpus": [
                {
                    "index": 0,
                    "used_vram_mb": 8192,
                    "total_vram_mb": 24576,
                    "utilization_percent": 75.0,
                    "temperature_c": 68.0,
                    "power_draw_w": 200.0,
                }
            ],
        },
    )

    rows = _snapshot_rows(node["node_id"])
    assert len(rows) == 1
    base = rows[0]
    assert base["cpu_usage_percent"] == 42.0
    assert base["gpu_utilization_percent"] == 75.0
    # 基准行: 所有 JSON 元数据非空
    assert base["cpu_json"] is not None
    assert base["memory_json"] is not None
    assert base["gpu_json"] is not None
    assert base["raw_payload_json"] is not None
    # sample_gpus_json: 即使没传 samples, 基准行也装该时刻的多卡数组
    compact = json.loads(base["sample_gpus_json"])
    assert compact == [
        {
            "idx": 0,
            "util": 75.0,
            "temp_c": 68.0,
            "vram_used_bytes": 8192 * 1024 * 1024,
        }
    ]


def test_five_samples_writes_six_rows_with_null_json_metadata(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """5 个 sample + 1 个基准 = 6 行. 高密 sample 行 JSON 元数据全 NULL, sample_gpus_json 非空."""
    node = _create_node(client, auth_headers, "node-5-samples")
    samples = [
        {
            "ts": f"2026-06-12T15:30:{sec:02d}.123Z",
            "cpu_percent": 60.0 + sec,
            "memory_percent": 47.0 + sec * 0.1,
            "gpus": [
                {
                    "idx": 0,
                    "util": 80.0 + sec,
                    "temp_c": 70.0 + sec * 0.1,
                    "vram_used_bytes": 12_000_000_000 + sec * 1000,
                    "power_w": 180.0 + sec,
                },
            ],
        }
        for sec in range(5)
    ]
    _send_heartbeat(
        client,
        node,
        {
            "boot_id": "boot-002",
            "heartbeat_interval_sec": 5,
            "sample_interval_sec": 1,
            "cpu": {"usage_percent": 65.0},
            "memory": {"usage_percent": 48.0},
            "gpus": [
                {
                    "index": 0,
                    "used_vram_mb": 12000,
                    "total_vram_mb": 24576,
                    "utilization_percent": 85.0,
                    "temperature_c": 72.0,
                    "power_draw_w": 220.0,
                }
            ],
            "samples": samples,
        },
    )

    rows = _snapshot_rows(node["node_id"])
    assert len(rows) == 6, f"应有 1 基准 + 5 sample = 6 行, 实际 {len(rows)}"

    # 通过 cpu_json 是否非空区分基准行 vs sample 行
    base_rows = [r for r in rows if r["cpu_json"] is not None]
    sample_rows = [r for r in rows if r["cpu_json"] is None]
    assert len(base_rows) == 1
    assert len(sample_rows) == 5

    # 基准行: 完整元数据 + 列化指标
    base = base_rows[0]
    assert base["cpu_usage_percent"] == 65.0
    assert base["gpu_utilization_percent"] == 85.0
    assert base["gpu_json"] is not None
    assert base["raw_payload_json"] is not None
    base_compact = json.loads(base["sample_gpus_json"])
    assert base_compact[0]["util"] == 85.0

    # sample 行: JSON 元数据 7 列全 NULL, 但列化数值和 sample_gpus_json 填充
    for i, row in enumerate(sample_rows):
        assert row["cpu_json"] is None
        assert row["memory_json"] is None
        assert row["gpu_json"] is None
        assert row["raw_payload_json"] is None
        assert row["cpu_usage_percent"] == 60.0 + i
        assert row["gpu_utilization_percent"] == 80.0 + i
        assert row["gpu_memory_percent"] == ((12_000_000_000 + i * 1000) / (24576 * 1024 * 1024)) * 100.0
        assert row["gpu_power_draw_w"] == 180.0 + i
        sample_compact = json.loads(row["sample_gpus_json"])
        assert sample_compact[0]["util"] == 80.0 + i
        assert sample_compact[0]["vram_used_bytes"] == 12_000_000_000 + i * 1000
        assert sample_compact[0]["power_w"] == 180.0 + i

    history_resp = client.get(f"/api/v1/admin/nodes/{node['node_id']}/status/history?limit=10", headers=auth_headers)
    assert history_resp.status_code == 200, history_resp.text
    history_items = history_resp.json()["items"]
    sample_items = [item for item in history_items if item["reported_at"].endswith(".123000+00:00")]
    assert len(sample_items) == 5
    assert sample_items[0]["gpu_memory_percent"] == (12_000_000_000 / (24576 * 1024 * 1024)) * 100.0
    assert sample_items[0]["gpu_power_draw_w"] == 180.0


def test_multi_gpu_samples_preserved_per_card(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """多卡场景: 每个 sample 内 gpus 数组完整保留所有卡, 不只装 GPU0."""
    node = _create_node(client, auth_headers, "node-multi-gpu")
    samples = [
        {
            "ts": f"2026-06-12T16:00:{sec:02d}.000Z",
            "cpu_percent": 70.0,
            "memory_percent": 50.0,
            "gpus": [
                {"idx": 0, "util": 80.0 + sec, "temp_c": 71.0, "vram_used_bytes": 10_000_000_000},
                {"idx": 1, "util": 90.0 + sec, "temp_c": 74.0, "vram_used_bytes": 18_000_000_000},
                {"idx": 2, "util": 65.0 + sec, "temp_c": 69.0, "vram_used_bytes": 8_000_000_000},
            ],
        }
        for sec in range(3)
    ]
    _send_heartbeat(
        client,
        node,
        {
            "boot_id": "boot-003",
            "heartbeat_interval_sec": 5,
            "sample_interval_sec": 1,
            "cpu": {"usage_percent": 70.0},
            "memory": {"usage_percent": 50.0},
            "gpus": [
                {"index": 0, "used_vram_mb": 9536, "total_vram_mb": 24576, "utilization_percent": 82.0, "temperature_c": 71.0},
                {"index": 1, "used_vram_mb": 17_166, "total_vram_mb": 24576, "utilization_percent": 92.0, "temperature_c": 74.0},
                {"index": 2, "used_vram_mb": 7_629, "total_vram_mb": 24576, "utilization_percent": 67.0, "temperature_c": 69.0},
            ],
            "samples": samples,
        },
    )

    rows = _snapshot_rows(node["node_id"])
    assert len(rows) == 4  # 1 基准 + 3 sample

    # 基准行的 sample_gpus_json 三张卡都在
    base = next(r for r in rows if r["cpu_json"] is not None)
    base_compact = json.loads(base["sample_gpus_json"])
    assert {g["idx"] for g in base_compact} == {0, 1, 2}
    assert base_compact[1]["vram_used_bytes"] == 17_166 * 1024 * 1024  # MiB -> bytes

    # sample 行的多卡数据也都在
    sample_rows = [r for r in rows if r["cpu_json"] is None]
    for i, row in enumerate(sample_rows):
        compact = json.loads(row["sample_gpus_json"])
        assert {g["idx"] for g in compact} == {0, 1, 2}
        # 验证多卡 util 按 idx 顺序保留, 各卡独立
        gpus_by_idx = {g["idx"]: g for g in compact}
        assert gpus_by_idx[0]["util"] == 80.0 + i
        assert gpus_by_idx[1]["util"] == 90.0 + i
        assert gpus_by_idx[2]["util"] == 65.0 + i


def test_invalid_sample_payload_rejected_with_422(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """sample 字段类型错 (gpu idx 为负) -> 422 ERR_VALIDATION_INVALID_PAYLOAD, 不落库."""
    node = _create_node(client, auth_headers, "node-bad-sample")
    body = json.dumps(
        {
            "boot_id": "boot-004",
            "heartbeat_interval_sec": 5,
            "cpu": {"usage_percent": 50.0},
            "memory": {"usage_percent": 50.0},
            "gpus": [],
            "samples": [
                {
                    "ts": "2026-06-12T17:00:00.000Z",
                    "cpu_percent": 50.0,
                    "memory_percent": 50.0,
                    "gpus": [{"idx": -1, "util": 80.0}],
                }
            ],
        }
    ).encode("utf-8")
    headers = build_signed_headers_for_test(node["node_id"], node["node_secret"], body)
    resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
    assert resp.status_code == 422
    body_json = resp.json()
    assert body_json["code"] == "ERR_VALIDATION_INVALID_PAYLOAD"
    # 验证无任何快照落库 (节点拒收前就 422)
    rows = _snapshot_rows(node["node_id"])
    assert rows == []


def test_latest_status_endpoints_return_base_row_not_sample(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """回归保护: GET /api/v1/admin/nodes/{id}/status/latest + GET /api/v1/admin/dashboard/overview 必须只取基准行.

    Bug 背景: sample 行 ts 比基准行 reported_at 晚, 单纯 ORDER BY reported_at DESC 会拿到 sample 行,
    sample 行的 JSON 列全为 NULL, 触发 _decode_gpu_snapshot(None) 抛 TypeError.
    修复: latest 类查询加 WHERE cpu_json IS NOT NULL 排除 sample 行.
    """
    node = _create_node(client, auth_headers, "node-latest-base-only")
    # 构造一次带 samples 的心跳, sample 的 ts 故意比 utc_now 晚 (服务端落地时 sample 行 reported_at > 基准行)
    samples = [
        {
            "ts": "2099-12-31T23:59:5{i}.123Z".replace("{i}", str(i)),
            "cpu_percent": 50.0 + i,
            "memory_percent": 50.0,
            "gpus": [{"idx": 0, "util": 70.0 + i, "temp_c": 60.0, "vram_used_bytes": 1_000_000_000}],
        }
        for i in range(5)
    ]
    _send_heartbeat(
        client,
        node,
        {
            "boot_id": "boot-latest-regression",
            "heartbeat_interval_sec": 5,
            "sample_interval_sec": 1,
            "cpu": {"usage_percent": 25.0},
            "memory": {"usage_percent": 40.0},
            "gpus": [
                {"index": 0, "used_vram_mb": 8192, "total_vram_mb": 24576,
                 "utilization_percent": 25.0, "temperature_c": 55.0, "power_draw_w": 100.0}
            ],
            "samples": samples,
        },
    )

    # status/latest endpoint 必须返基准行数据 (cpu_usage=25.0), 不是 sample 行 (cpu_pct=50+)
    latest_resp = client.get(f"/api/v1/admin/nodes/{node['node_id']}/status/latest", headers=auth_headers)
    assert latest_resp.status_code == 200, latest_resp.text
    body = latest_resp.json()
    assert body["cpu"]["usage_percent"] == 25.0, f"got cpu={body['cpu']['usage_percent']} (sample 行污染了 latest)"
    assert body["gpus"][0]["utilization_percent"] == 25.0  # 不应该是 70+ (sample 行)

    # dashboard/overview 同样过滤
    overview_resp = client.get("/api/v1/admin/dashboard/overview", headers=auth_headers)
    assert overview_resp.status_code == 200, overview_resp.text
    nodes = overview_resp.json().get("nodes", [])
    target = next((n for n in nodes if n["node_id"] == node["node_id"]), None)
    assert target is not None
    assert target["latest_status"] is not None
    assert target["latest_status"]["cpu"]["usage_percent"] == 25.0


def test_sample_ts_collision_with_base_is_skipped(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """如果 sample.ts 恰好与基准行 reported_at 重合, 跳过该 sample 避免重复行.

    这种重合理论上极少 (基准 ts 是服务端 utc_now_iso 落地秒), 但要确保不写脏数据.
    """
    node = _create_node(client, auth_headers, "node-ts-dup")
    # 同一 ts 出现两次: 服务端会跳过第二个
    samples = [
        {"ts": "2026-06-12T18:00:00.000Z", "cpu_percent": 50.0, "memory_percent": 50.0, "gpus": []},
        {"ts": "2026-06-12T18:00:00.000Z", "cpu_percent": 51.0, "memory_percent": 51.0, "gpus": []},
        {"ts": "2026-06-12T18:00:01.000Z", "cpu_percent": 52.0, "memory_percent": 52.0, "gpus": []},
    ]
    _send_heartbeat(
        client,
        node,
        {
            "boot_id": "boot-005",
            "heartbeat_interval_sec": 5,
            "sample_interval_sec": 1,
            "cpu": {"usage_percent": 50.0},
            "memory": {"usage_percent": 50.0},
            "gpus": [],
            "samples": samples,
        },
    )
    rows = _snapshot_rows(node["node_id"])
    # 1 基准 + 2 unique samples (重复 ts 的第二个被跳过)
    assert len(rows) == 3

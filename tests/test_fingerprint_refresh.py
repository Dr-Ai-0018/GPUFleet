"""节点指纹手动刷新通道验收 (设计来源: docs/Probe_Rewrite_Plan.md §3.C).

机制:
- POST /api/v1/admin/nodes/{node_id}/refresh-fingerprint → 加入 app.state.pending_fingerprint_refresh
- 该节点下次心跳: HeartbeatResponse.refresh_fingerprint = True + 从 set 移除
- 再次心跳: refresh_fingerprint = False (一次性触发)
- DB schema 零改动: 全部用 in-memory set
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.security import build_signed_headers_for_test


# 给每个测试一个单调递增的 timestamp 序列, 避免同秒心跳触发 last_request_ts 单调校验 409
_test_ts_counter = {"v": 0}


def _next_ts() -> str:
    _test_ts_counter["v"] += 1
    return (datetime.now(UTC).replace(microsecond=0) + timedelta(seconds=_test_ts_counter["v"])).isoformat()


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str) -> dict[str, object]:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Fingerprint Test Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/tmp/work"],
            "tags": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _send_heartbeat(client: TestClient, node: dict[str, object]) -> dict[str, object]:
    payload = {
        "boot_id": "boot-fp-test",
        "heartbeat_interval_sec": 5,
        "cpu": {"usage_percent": 30.0},
        "memory": {"usage_percent": 40.0},
        "gpus": [],
    }
    body = json.dumps(payload).encode("utf-8")
    headers = build_signed_headers_for_test(
        node["node_id"], node["node_secret"], body, timestamp=_next_ts()
    )
    resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_default_heartbeat_response_has_refresh_fingerprint_false(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """没人 POST refresh 时, 心跳 response 默认 refresh_fingerprint=False."""
    node = _create_node(client, auth_headers, "node-fp-default")
    body = _send_heartbeat(client, node)
    assert body.get("refresh_fingerprint") is False


def test_post_refresh_endpoint_queues_and_next_heartbeat_delivers(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """POST refresh-fingerprint → 202; 下次心跳 response.refresh_fingerprint=True; 再下次 False."""
    node = _create_node(client, auth_headers, "node-fp-trigger")

    # 1. POST refresh - 期望 202 + queued status
    resp = client.post(
        f"/api/v1/admin/nodes/{node['node_id']}/refresh-fingerprint",
        headers=auth_headers,
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "refresh_queued"
    assert body["node_id"] == node["node_id"]

    # 2. 下次心跳 - refresh_fingerprint=True
    hb1 = _send_heartbeat(client, node)
    assert hb1.get("refresh_fingerprint") is True, "首次心跳后应下发 refresh"

    # 3. 再下次心跳 - 一次性触发, refresh_fingerprint=False
    hb2 = _send_heartbeat(client, node)
    assert hb2.get("refresh_fingerprint") is False, "应只触发一次, 不重复"


def test_post_refresh_is_idempotent(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """重复 POST refresh-fingerprint → 仍然 202; set 是 set, 不会重复. 心跳只触发一次."""
    node = _create_node(client, auth_headers, "node-fp-idempotent")

    for _ in range(3):
        resp = client.post(
            f"/api/v1/admin/nodes/{node['node_id']}/refresh-fingerprint",
            headers=auth_headers,
        )
        assert resp.status_code == 202

    hb1 = _send_heartbeat(client, node)
    assert hb1.get("refresh_fingerprint") is True

    hb2 = _send_heartbeat(client, node)
    assert hb2.get("refresh_fingerprint") is False


def test_post_refresh_unknown_node_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """触发不存在的节点 → 404 ERR_NODE_NOT_FOUND."""
    resp = client.post(
        "/api/v1/admin/nodes/no-such-node/refresh-fingerprint",
        headers=auth_headers,
    )
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "ERR_NODE_NOT_FOUND"


def test_post_refresh_writes_audit_event(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """触发 refresh → audit_events 表里有一条 action='refresh_node_fingerprint' 记录."""
    node = _create_node(client, auth_headers, "node-fp-audit")
    resp = client.post(
        f"/api/v1/admin/nodes/{node['node_id']}/refresh-fingerprint",
        headers=auth_headers,
    )
    assert resp.status_code == 202

    audit_resp = client.get("/api/v1/admin/audit-events?limit=10", headers=auth_headers)
    assert audit_resp.status_code == 200
    events = audit_resp.json()
    matching = [e for e in events if e["action"] == "refresh_node_fingerprint" and e["target_id"] == node["node_id"]]
    assert len(matching) >= 1, f"audit_events 应含 refresh_node_fingerprint 记录, got: {events}"
    assert matching[0]["actor_type"] == "admin"


def test_refresh_one_node_does_not_affect_others(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """触发 A 节点 refresh, B 节点心跳的 response.refresh_fingerprint=False."""
    node_a = _create_node(client, auth_headers, "node-fp-a")
    node_b = _create_node(client, auth_headers, "node-fp-b")

    resp = client.post(
        f"/api/v1/admin/nodes/{node_a['node_id']}/refresh-fingerprint",
        headers=auth_headers,
    )
    assert resp.status_code == 202

    hb_b = _send_heartbeat(client, node_b)
    assert hb_b.get("refresh_fingerprint") is False, "B 节点不应被 A 节点的 refresh 触发"

    hb_a = _send_heartbeat(client, node_a)
    assert hb_a.get("refresh_fingerprint") is True

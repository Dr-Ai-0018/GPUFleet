from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from httpx import Response

from app.security import build_signed_headers_for_test


def _create_node(client: TestClient, auth_headers: dict[str, str], node_id: str = "onboarding-node") -> dict[str, object]:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": node_id,
            "display_name": "Onboarding Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/workspace"],
            "tags": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _heartbeat(
    client: TestClient,
    node_id: str,
    node_secret: str,
    boot_id: str,
    *,
    timestamp: str | None = None,
) -> Response:
    body = json.dumps({"boot_id": boot_id, "heartbeat_interval_sec": 5}).encode("utf-8")
    headers = build_signed_headers_for_test(node_id, node_secret, body, timestamp=timestamp)
    return client.post("/api/v1/node/heartbeat", content=body, headers=headers)


def test_get_onboarding_returns_pending_token_and_templates(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    node = _create_node(client, auth_headers)

    resp = client.get(f"/api/v1/admin/nodes/{node['node_id']}/onboarding", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token"] == node["node_secret"]
    assert body["token_status"] == "active"
    assert body["token_expires_at"] is None
    assert f"GPUFLEET_AGENT_NODE_ID={node['node_id']}" in body["env_template"]
    assert f"GPUFLEET_AGENT_NODE_SECRET={node['node_secret']}" in body["install_snippet"]
    assert "uv run gpufleet-agent heartbeat-loop" in body["install_snippet"]


def test_get_onboarding_hides_consumed_token_after_first_heartbeat(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    node = _create_node(client, auth_headers, "consumed-onboarding-node")
    heartbeat_resp = _heartbeat(client, node["node_id"], node["node_secret"], "boot-consumed")
    assert heartbeat_resp.status_code == 200, heartbeat_resp.text

    resp = client.get(f"/api/v1/admin/nodes/{node['node_id']}/onboarding", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token"] is None
    assert body["token_status"] == "consumed"
    assert "GPUFLEET_AGENT_NODE_SECRET=<regenerate-token-to-view-secret>" in body["env_template"]


def test_regenerate_onboarding_rotates_token_and_allows_new_heartbeat(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    node = _create_node(client, auth_headers, "regenerate-onboarding-node")
    old_secret = node["node_secret"]

    resp = client.post(f"/api/v1/admin/nodes/{node['node_id']}/onboarding/regenerate", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    new_secret = body["token"]
    assert body["token_status"] == "active"
    assert new_secret
    assert new_secret != old_secret
    assert f"GPUFLEET_AGENT_NODE_SECRET={new_secret}" in body["env_template"]

    old_resp = _heartbeat(client, node["node_id"], old_secret, "boot-old-secret")
    assert old_resp.status_code == 401

    new_resp = _heartbeat(client, node["node_id"], new_secret, "boot-new-secret")
    assert new_resp.status_code == 200, new_resp.text


def test_regenerate_onboarding_reopens_token_for_connected_node(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    node = _create_node(client, auth_headers, "connected-regenerate-node")
    first_ts = datetime.now(UTC).replace(microsecond=0)
    first_resp = _heartbeat(
        client,
        node["node_id"],
        node["node_secret"],
        "boot-before-regenerate",
        timestamp=first_ts.isoformat(),
    )
    assert first_resp.status_code == 200, first_resp.text

    regenerate_resp = client.post(f"/api/v1/admin/nodes/{node['node_id']}/onboarding/regenerate", headers=auth_headers)

    assert regenerate_resp.status_code == 200, regenerate_resp.text
    new_secret = regenerate_resp.json()["token"]
    assert new_secret
    assert regenerate_resp.json()["token_status"] == "active"

    second_resp = _heartbeat(
        client,
        node["node_id"],
        new_secret,
        "boot-after-regenerate",
        timestamp=(first_ts + timedelta(seconds=60)).isoformat(),
    )
    assert second_resp.status_code == 200, second_resp.text

    consumed_resp = client.get(f"/api/v1/admin/nodes/{node['node_id']}/onboarding", headers=auth_headers)
    assert consumed_resp.status_code == 200, consumed_resp.text
    assert consumed_resp.json()["token"] is None
    assert consumed_resp.json()["token_status"] == "consumed"

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.security import build_signed_headers_for_test


def _create_node(client: TestClient, auth_headers: dict[str, str]) -> dict:
    resp = client.post(
        "/api/v1/admin/nodes",
        headers=auth_headers,
        json={
            "node_id": "route-node",
            "display_name": "Route Node",
            "node_type": "physical",
            "os_type": "linux",
            "heartbeat_interval_sec": 5,
            "allowed_workdirs": ["/workspace"],
            "tags": [],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_api_v1_routes_cover_all_routers(client: TestClient, auth_headers: dict[str, str]) -> None:
    node = _create_node(client, auth_headers)

    auth_resp = client.post(
        "/api/v1/admin/login",
        json={"username": "admin", "password": "test-admin-pass"},
    )
    assert auth_resp.status_code == 200

    assert client.get("/api/v1/admin/dashboard/overview", headers=auth_headers).status_code == 200
    assert client.get("/api/v1/admin/nodes", headers=auth_headers).status_code == 200
    assert client.get(f"/api/v1/admin/nodes/{node['node_id']}", headers=auth_headers).status_code == 200
    assert client.get("/api/v1/admin/audit-events", headers=auth_headers).status_code == 200
    assert client.get("/api/v1/admin/alerts/unread-count", headers=auth_headers).status_code == 200

    task_resp = client.post(
        "/api/v1/admin/tasks",
        headers=auth_headers,
        json={
            "node_id": node["node_id"],
            "type": "health_check",
            "payload": {},
            "workdir": "/workspace",
        },
    )
    assert task_resp.status_code == 201, task_resp.text

    body = json.dumps({"boot_id": "route-boot", "heartbeat_interval_sec": 5}).encode()
    headers = build_signed_headers_for_test(
        node_id=node["node_id"],
        node_secret=node["node_secret"],
        body=body,
    )
    heartbeat_resp = client.post("/api/v1/node/heartbeat", content=body, headers=headers)
    assert heartbeat_resp.status_code == 200, heartbeat_resp.text


def test_legacy_api_paths_are_removed(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.post(
        "/api/admin/login",
        json={"username": "admin", "password": "test-admin-pass"},
    ).status_code == 404
    assert client.get("/api/admin/nodes", headers=auth_headers).status_code == 404
    assert client.post("/api/node/heartbeat", json={"boot_id": "legacy-boot"}).status_code == 404


def test_openapi_only_exposes_api_v1_paths(client: TestClient) -> None:
    paths = set(client.get("/openapi.json").json()["paths"])

    versioned_paths = {path for path in paths if path.startswith("/api/")}
    assert versioned_paths
    assert all(path.startswith("/api/v1/") for path in versioned_paths)
    assert "/api/v1/admin/login" in paths
    assert "/api/v1/node/heartbeat" in paths

    legacy_paths = {path for path in paths if path.startswith(("/api/admin", "/api/node"))}
    assert legacy_paths == set()

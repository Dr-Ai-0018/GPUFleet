# GPUFleet

GPUFleet is a lightweight control plane for heterogeneous GPU nodes in trusted personal environments.

Repository layout rule:

- The repository root is for the control plane.
- All node deployment files must live under [node_agent/README.md](node_agent/README.md).
- The React console lives under `frontend/`.

The MVP targets one thing first: a stable closed loop for:

- heartbeat
- task dispatch
- log upload
- kill / process cleanup

This project uses a `node actively reports -> center returns tasks` architecture so that nodes behind NAT or internal networks can still participate without requiring inbound SSH or persistent WebSocket connections.

## Current Status

The repository is now in a usable `Phase 1 / MVP v0.1` implementation stage.

See the detailed architecture and frozen decisions here:

- [docs/GPUFleet_MVP_v0.1_Architecture.md](docs/GPUFleet_MVP_v0.1_Architecture.md)

Already implemented:

- admin login
- manual node registration
- signed node heartbeat
- SQLite persistence for node and status data
- manual task creation, cancellation, status lookup, log preview, and task result ingestion
- task artifact upload and artifact listing
- React console dashboard for login, node overview, task submission, task detail, log preview, artifact summary, audit events, and security warnings
- node-side task execution for physical nodes and Modal runner nodes
- Modal runner credential-pool support and structured `modal_command` execution
- NVIDIA driver / CUDA capability snapshot in heartbeat

## MVP Principles

- Heterogeneous node support: Windows, Linux, multi-GPU, and Modal runner
- Pull-based task delivery in heartbeat response
- Single task at a time per node in phase 1
- Core logs centralized, full logs retained on node, selected files may be uploaded back to center
- Strong auditing and explicit dangerous-operation boundaries
- Publicly reachable control plane with strong authentication and signed node requests

## Phase 1 Goal

Build a control console that the owner can reliably use for:

- node registration and heartbeat
- manual task submission to a specific node
- task execution and result upload
- incremental log viewing
- task cancellation and real process cleanup
- state recovery after node restart or temporary disconnect

Additional local design notes for current development:

- [docs/GPUFleet_Deployment_And_Smoke_Test.md](docs/GPUFleet_Deployment_And_Smoke_Test.md)
- [docs/GPUFleet_Node_Deployment_Modes.md](docs/GPUFleet_Node_Deployment_Modes.md)
- [docs/GPUFleet_ModalRunner_Design.md](docs/GPUFleet_ModalRunner_Design.md)
- [docs/Modal_Credential_Pool_Design.md](docs/Modal_Credential_Pool_Design.md)
- [docs/Modal_Official_Dev_Notes.md](docs/Modal_Official_Dev_Notes.md)

## Quick Start

1. Create a virtual environment:

   ```bash
   uv venv
   ```

2. Install dependencies:

   ```bash
   uv sync
   ```

3. Optionally override defaults with environment variables:

   ```bash
   copy .env.example .env
   ```

4. Start the control plane:

   ```bash
   uv run uvicorn app.main:app --reload
   ```

5. Install and build the React console:

   ```bash
   cd frontend
   pnpm install
   pnpm build
   ```

6. Open the console or Swagger UI:

   - [http://127.0.0.1:8000/console](http://127.0.0.1:8000/console)
   - [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

## Implemented API Surface

- `POST /api/admin/login`
- `POST /api/admin/refresh`
- `GET /api/admin/me`
- `GET /api/admin/nodes`
- `POST /api/admin/nodes`
- `GET /api/admin/nodes/{node_id}`
- `PATCH /api/admin/nodes/{node_id}`
- `POST /api/admin/nodes/{node_id}/enable`
- `POST /api/admin/nodes/{node_id}/disable`
- `GET /api/admin/nodes/{node_id}/status/latest`
- `POST /api/admin/tasks`
- `GET /api/admin/tasks`
- `GET /api/admin/tasks/{task_id}`
- `POST /api/admin/tasks/{task_id}/cancel`
- `GET /api/admin/tasks/{task_id}/logs`
- `GET /api/admin/tasks/{task_id}/artifacts`
- `POST /api/node/heartbeat`
- `POST /api/node/task-events`
- `POST /api/node/task-log-chunk`
- `POST /api/node/task-result`
- `POST /api/node/artifact-upload`

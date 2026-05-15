# Node Agent Workspace

This subfolder is reserved for all node-side deployment files.

Rules for this repository:

- The repository root is the control-plane main workspace.
- All deployable node-side files must live under this folder.
- Future Agent code, runtime config templates, install scripts, and packaging files should be added here instead of mixing into the control-plane root.

Planned contents:

- `src/` for node agent runtime code
- `configs/` for node configuration templates
- `scripts/` for install/start helpers
- `README.md` for node deployment instructions

## Current Status

The first node-side scaffold now exists with:

- `pyproject.toml`
- `src/gpufleet_node_agent/config.py`
- `src/gpufleet_node_agent/security.py`
- `src/gpufleet_node_agent/state.py`
- `src/gpufleet_node_agent/heartbeat.py`
- `src/gpufleet_node_agent/main.py`
- `.env.example`

This is intentionally minimal and currently focuses on:

- local runtime directory structure
- node signing logic
- heartbeat payload construction
- signed heartbeat POST to the control plane
- minimal task execution for `health_check`, `shell`, and `python_script`
- result/log/artifact upload back to the control plane

## Tonight's Goal

The immediate target is the first local chain:

- start the control plane on the main machine
- register a node in the control plane
- configure the node agent in this folder
- detect local CPU / memory / disk / Python / NVIDIA GPU state
- send a successful signed heartbeat to the control plane

## Quick Start

1. In the repository root, start the control plane:

   ```bash
   uv run uvicorn app.main:app --reload
   ```

2. In this folder, create the node agent environment:

   ```bash
   uv sync
   copy .env.example .env
   ```

3. Fill in `.env` with the registered `node_id` and `node_secret`.

4. Run one heartbeat:

   ```bash
   uv run gpufleet-agent heartbeat-once
   ```

5. Or run the loop:

   ```bash
   uv run gpufleet-agent heartbeat-loop
   ```

## Current Detection Coverage

- CPU model / logical cores / basic usage estimate
- memory total / used / usage
- disk usage for all visible local Windows drive letters or current Linux root
- Python executable / version / pip availability
- NVIDIA GPU list through `nvidia-smi` when available

## Current Task Coverage

- `health_check`
- `shell`
- `python_script`

The MVP task runner currently executes one returned task at a time, writes local logs under `runtime/runs/`, uploads stdout/stderr in chunks after process completion, and then uploads a `result_summary.json` artifact.

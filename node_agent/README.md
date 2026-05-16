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
- `templates/` for reusable Modal or task templates
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

This is intentionally lightweight and currently focuses on:

- local runtime directory structure
- node signing logic
- heartbeat payload construction
- signed heartbeat POST to the control plane
- single-node task execution and recovery in phase 1
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
- `pip_install`
- `git_pull`
- `download_file`
- `file_mkdir`
- `file_write`
- `file_patch_text`
- `file_move`
- `file_delete`
- `file_preview`
- `file_extract`
- `upload_and_unpack`
- `modal_command`

The phase-1 task runner currently executes one platform task at a time, writes local logs under `runtime/runs/`, uploads stdout/stderr incrementally, and then uploads a `result_summary.json` artifact.

## Modal Runner Notes

For Modal-enabled nodes, prefer running the agent through the `uv` environment created by `uv sync`, because the Modal CLI dependency is installed there:

```bash
uv run gpufleet-agent heartbeat-once
uv run gpufleet-agent heartbeat-loop
```

If this node is used as a `modal_runner`, keep all real Modal credentials local to that host.

Recommended supporting files:

- example credential pool: [configs/modal_credentials.example.json](E:\Project\GPUFleet\node_agent\configs\modal_credentials.example.json)
- base broad-coverage image template: [templates/modal/modal_base_ml_template.py](E:\Project\GPUFleet\node_agent\templates\modal\modal_base_ml_template.py)
- deployment mode guide: [GPUFleet_Node_Deployment_Modes.md](E:\Project\GPUFleet\docs\GPUFleet_Node_Deployment_Modes.md)

Ready-made env templates:

- [configs/node.windows_server.env.example](E:\Project\GPUFleet\node_agent\configs\node.windows_server.env.example)
- [configs/node.linux_server.env.example](E:\Project\GPUFleet\node_agent\configs\node.linux_server.env.example)
- [configs/node.modal_runner.env.example](E:\Project\GPUFleet\node_agent\configs\node.modal_runner.env.example)

Recommended local-only config:

- `GPUFLEET_AGENT_MODAL_CREDENTIALS_PATH`
- `GPUFLEET_AGENT_MODAL_DEFAULT_CREDENTIAL_NAME`
- `GPUFLEET_AGENT_MODAL_DEFAULT_ENVIRONMENT`
- `GPUFLEET_AGENT_MODAL_DEFAULT_WORKSPACE`

Current `modal_command` support:

- raw `payload.command`
- structured `payload.script_path`
- structured `payload.module_path`
- optional `payload.entrypoint`
- optional `payload.args`
- optional `payload.write_result_path`

The node agent now injects the selected Modal credential pair into the task environment at runtime and records the chosen credential logical name in the task result summary. Do not commit real token pairs into this repository.

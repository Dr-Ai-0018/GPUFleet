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

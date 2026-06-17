#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/gpufleet-agent"
SERVICE_NAME="gpufleet-agent"
CONTROL_URL=""
NODE_ID=""
NODE_TOKEN=""
WHEEL_URL=""
DRY_RUN=0
UNINSTALL=0

usage() {
  cat <<'EOF'
Usage:
  install.sh --url https://localhost --token <node-secret> --node-id <node-id> [--wheel-url URL] [--dry-run]
  install.sh --uninstall [--dry-run]

Options:
  --url          GPUFleet control-plane URL.
  --token        Node onboarding token / node secret from the console.
  --node-id      Registered GPUFleet node id.
  --wheel-url    Optional wheel URL. If omitted, installs from this node_agent source tree.
  --install-dir  Install directory. Default: /opt/gpufleet-agent.
  --dry-run      Print actions without changing the host.
  --uninstall    Stop service and remove installed unit/files.
EOF
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

write_file() {
  local path="$1"
  local content="$2"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] write %s\n%s\n' "$path" "$content"
  else
    install -d "$(dirname "$path")"
    printf '%s\n' "$content" > "$path"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url) CONTROL_URL="${2:-}"; shift 2 ;;
    --token) NODE_TOKEN="${2:-}"; shift 2 ;;
    --node-id) NODE_ID="${2:-}"; shift 2 ;;
    --wheel-url) WHEEL_URL="${2:-}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  echo "Please run as root, or use --dry-run to preview." >&2
  exit 1
fi

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_PATH="/etc/${SERVICE_NAME}.env"
CONFIG_PATH="${INSTALL_DIR}/config.toml"
VENV_PATH="${INSTALL_DIR}/venv"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$UNINSTALL" -eq 1 ]; then
  run systemctl disable --now "$SERVICE_NAME"
  run rm -f "$UNIT_PATH" "$ENV_PATH"
  run systemctl daemon-reload
  run rm -rf "$INSTALL_DIR"
  exit 0
fi

if [ -z "$CONTROL_URL" ]; then
  read -r -p "Control plane URL: " CONTROL_URL
fi
if [ -z "$NODE_ID" ]; then
  read -r -p "Node id: " NODE_ID
fi
if [ -z "$NODE_TOKEN" ]; then
  read -r -s -p "Node token / secret: " NODE_TOKEN
  printf '\n'
fi

if [ -z "$CONTROL_URL" ] || [ -z "$NODE_ID" ] || [ -z "$NODE_TOKEN" ]; then
  echo "url, node-id and token are required." >&2
  exit 2
fi

run install -d "$INSTALL_DIR" "${INSTALL_DIR}/state" "${INSTALL_DIR}/repos" "${INSTALL_DIR}/runs" "${INSTALL_DIR}/artifacts" "${INSTALL_DIR}/logs" "${INSTALL_DIR}/modal_profiles"
run python3 -m venv "$VENV_PATH"
run "$VENV_PATH/bin/python" -m pip install --upgrade pip

if [ -n "$WHEEL_URL" ]; then
  run "$VENV_PATH/bin/python" -m pip install "$WHEEL_URL"
else
  run "$VENV_PATH/bin/python" -m pip install "$SCRIPT_DIR"
fi

write_file "$CONFIG_PATH" "[agent]
control_plane_url = \"$CONTROL_URL\"
node_id = \"$NODE_ID\"
heartbeat_interval_sec = 5
deployment_mode = \"linux_server\"
agent_root = \"$INSTALL_DIR\"
"

write_file "$ENV_PATH" "GPUFLEET_AGENT_CONTROL_PLANE_URL=$CONTROL_URL
GPUFLEET_AGENT_NODE_ID=$NODE_ID
GPUFLEET_AGENT_NODE_SECRET=$NODE_TOKEN
GPUFLEET_AGENT_NODE_SECRET_ENCRYPTED_PATH=${INSTALL_DIR}/state/node_secret.enc
GPUFLEET_AGENT_NODE_SECRET_PASSPHRASE=${NODE_TOKEN}
GPUFLEET_AGENT_HEARTBEAT_INTERVAL_SEC=5
GPUFLEET_AGENT_DEPLOYMENT_MODE=linux_server
GPUFLEET_AGENT_AGENT_ROOT=$INSTALL_DIR
GPUFLEET_AGENT_REPOS_DIR=${INSTALL_DIR}/repos
GPUFLEET_AGENT_RUNS_DIR=${INSTALL_DIR}/runs
GPUFLEET_AGENT_ARTIFACTS_DIR=${INSTALL_DIR}/artifacts
GPUFLEET_AGENT_LOGS_DIR=${INSTALL_DIR}/logs
GPUFLEET_AGENT_STATE_DIR=${INSTALL_DIR}/state
GPUFLEET_AGENT_MODAL_PROFILES_DIR=${INSTALL_DIR}/modal_profiles
"

write_file "$UNIT_PATH" "[Unit]
Description=GPUFleet Node Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_PATH
WorkingDirectory=$INSTALL_DIR
ExecStart=$VENV_PATH/bin/gpufleet-agent heartbeat-loop
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
"

run chmod 600 "$ENV_PATH"
run systemctl daemon-reload
run systemctl enable --now "$SERVICE_NAME"

echo "GPUFleet agent installed. Check status with: systemctl status ${SERVICE_NAME}"

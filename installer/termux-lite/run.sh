#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

REPO_ROOT="$(clawmobile_lite_repo_root)"
PLUGIN_DIR="$REPO_ROOT/openclaw-plugin-mobile-ui"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_BIND="${GATEWAY_BIND:-loopback}"

clawmobile_require_termux
clawmobile_lite_env
clawmobile_require_openclaw
clawmobile_require_npm

cd "$REPO_ROOT"
clawmobile_select_adb_device
clawmobile_build_plugin_lite "$REPO_ROOT"
clawmobile_install_plugin "$PLUGIN_DIR"
clawmobile_sync_workspace_seed "$REPO_ROOT"

ensure_gateway_config() {
  local current=""

  current="$(openclaw config get gateway.mode 2>/dev/null || true)"
  if [ "$current" != "local" ]; then
    echo "[lite] Setting OpenClaw gateway.mode=local"
    openclaw config set gateway.mode local </dev/null >/dev/null
  fi

  current="$(openclaw config get gateway.port 2>/dev/null || true)"
  if [ "$current" != "$GATEWAY_PORT" ]; then
    echo "[lite] Setting OpenClaw gateway.port=$GATEWAY_PORT"
    openclaw config set gateway.port "$GATEWAY_PORT" </dev/null >/dev/null
  fi

  current="$(openclaw config get gateway.bind 2>/dev/null || true)"
  if [ "$current" != "$GATEWAY_BIND" ]; then
    echo "[lite] Setting OpenClaw gateway.bind=$GATEWAY_BIND"
    openclaw config set gateway.bind "$GATEWAY_BIND" </dev/null >/dev/null
  fi
}

ensure_gateway_config

if [ "${CLAWMOBILE_TERMUX_REFRESH_DEFAULTS_ON_RUN:-0}" = "1" ]; then
  echo "[lite] Refreshing OpenClaw Termux runtime defaults before gateway start..."
  openclaw config set tools.profile full </dev/null
fi

echo "[lite] Starting OpenClaw Gateway in capability-aware Termux runtime mode..."
exec openclaw gateway --bind "$GATEWAY_BIND" --port "$GATEWAY_PORT" --verbose

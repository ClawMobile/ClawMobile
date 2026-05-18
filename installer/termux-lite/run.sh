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

if [ "${CLAWMOBILE_LITE_REFRESH_DEFAULTS_ON_RUN:-0}" = "1" ]; then
  echo "[lite] Refreshing OpenClaw Lite defaults before gateway start..."
  openclaw config set tools.profile full </dev/null
fi

echo "[lite] Starting OpenClaw Gateway in capability-aware Lite mode..."
exec openclaw gateway --bind "$GATEWAY_BIND" --port "$GATEWAY_PORT" --verbose

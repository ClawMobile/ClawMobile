#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${GATEWAY_PORT:-}" ] && [ -n "${CLAWMOBILE_GATEWAY_PORT:-}" ]; then
  export GATEWAY_PORT="$CLAWMOBILE_GATEWAY_PORT"
fi

echo "[lite] Starting OpenClaw Gateway through clawmobile run path..."
exec "$SCRIPT_DIR/run.sh" "$@"

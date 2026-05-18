#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  clawmobile pair <PAIRING_CODE>
  clawmobile pair "<paste the bot message containing the code>"

Pairing code format: 8 chars, uppercase letters + digits, e.g. A1B2C3D4
EOF
  exit 1
}

if [ $# -lt 1 ]; then
  usage
fi

raw="$*"
code="$(printf '%s' "$raw" | tr -d ' \t\r\n' | grep -oE '[A-Z0-9]{8}' | head -n 1 || true)"
if [ -z "$code" ]; then
  code="$(printf '%s' "$raw" | grep -oE '[A-Z0-9]{8}' | head -n 1 || true)"
fi
if [ -z "$code" ]; then
  echo "[lite] ERROR: Could not find an 8-char uppercase alnum pairing code in: $raw" >&2
  usage
fi

clawmobile_require_termux
clawmobile_lite_env
clawmobile_require_openclaw

echo "[lite] Approving Telegram pairing code: $code"
exec openclaw pairing approve telegram "$code"

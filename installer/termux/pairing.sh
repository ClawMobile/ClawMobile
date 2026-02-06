#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu-22.04}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  echo "Usage:"
  echo "  ./installer/termux/pair.sh <PAIRING_CODE>"
  echo "  ./installer/termux/pair.sh \"<paste the bot message containing the code>\""
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

RAW="$*"

# Extract first number token as pairing code (works if you paste a full message)
# If user passed only a code, this still works.
CODE="$(echo "$RAW" | grep -oE '[0-9]{4,12}' | head -n 1 || true)"

if [[ -z "${CODE}" ]]; then
  echo "[pair] ERROR: Could not find a numeric pairing code in: ${RAW}"
  usage
fi

echo "[pair] Approving Telegram pairing code: ${CODE}"
proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc "
    set -e
    cd '${REPO_ROOT}' || true
    openclaw pairing approve telegram '${CODE}'
  "

echo "[pair] Done."
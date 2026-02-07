#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  echo "Usage:"
  echo "  ./installer/termux/pair.sh <PAIRING_CODE>"
  echo "  ./installer/termux/pair.sh \"<paste the bot message containing the code>\""
  echo
  echo "Pairing code format: 8 chars, uppercase letters + digits, e.g. A1B2C3D4"
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

RAW="$*"

# Extract first token matching 8 uppercase alnum characters
# - Works if user passes only the code
# - Works if user pastes a full message containing the code
CODE="$(echo "$RAW" | tr -d ' \t\r\n' | grep -oE '[A-Z0-9]{8}' | head -n 1 || true)"

if [[ -z "${CODE}" ]]; then
  # Fallback: search within original text without stripping spaces (some messages may contain punctuation)
  CODE="$(echo "$RAW" | grep -oE '[A-Z0-9]{8}' | head -n 1 || true)"
fi

if [[ -z "${CODE}" ]]; then
  echo "[pair] ERROR: Could not find an 8-char uppercase alnum pairing code in:"
  echo "       ${RAW}"
  usage
fi

echo "[pair] Approving Telegram pairing code: ${CODE}"
proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc "
    set -e
    cd '${REPO_ROOT}' || true

    if [ -f installer/ubuntu/env.sh ]; then
      source installer/ubuntu/env.sh
    fi

    openclaw pairing approve telegram '${CODE}'
  "

echo "[pair] Done."
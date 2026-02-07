#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu-22.04}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_BIND="${GATEWAY_BIND:-loopback}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "[clawbot] Starting OpenClaw Gateway..."
proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc "
    set -e
    cd '${REPO_ROOT}'

    if [ -f installer/ubuntu/env.sh ]; then
      source installer/ubuntu/env.sh
    fi

    exec openclaw gateway --bind ${GATEWAY_BIND} --port ${GATEWAY_PORT} --verbose
  "
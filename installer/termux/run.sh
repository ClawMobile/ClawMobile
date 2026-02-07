#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_BIND="${GATEWAY_BIND:-loopback}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "[clawbot] Starting OpenClaw Gateway..."
proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc "
    set -e
    cd '${REPO_ROOT}'
    
    # ---- activate python virtual environment ----
    if [ -f '${REPO_ROOT}/.venv/bin/activate' ]; then
      source '${REPO_ROOT}/.venv/bin/activate'
    fi

    # ---- ensure env.sh patch also loads ----
    if [ -f installer/ubuntu/env.sh ]; then
      source installer/ubuntu/env.sh
    fi

    REPO_RULES="$REPO_ROOT/memory"
    if [ -d "$REPO_RULES" ]; then
    openclaw config set agents.defaults.memorySearch.extraPaths "[\"$REPO_RULES\"]" >/dev/null 2>&1 || true
    echo "[run] memorySearch.extraPaths set to: $REPO_RULES"
    else
    echo "[run] memory folder not found at $REPO_RULES (ok)"
    fi

    exec openclaw gateway --bind ${GATEWAY_BIND} --port ${GATEWAY_PORT} --verbose
  "
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "[clawbot] Entering Ubuntu and starting OpenClaw onboard..."
echo "[clawbot] When you see 'Onboard complete', press Ctrl+C to exit onboard if it does not."
echo

proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc "
    set -e
    cd '${REPO_ROOT}'
    # Make sure our Node patch is active even in non-interactive shells
    if [ -f installer/ubuntu/env.sh ]; then
      source installer/ubuntu/env.sh
    fi
    openclaw onboard --skip-daemon ${*:-}
  "
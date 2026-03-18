#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "[clawmobile] Entering Ubuntu and starting OpenClaw onboarding..."
echo "[clawmobile] When you see 'Onboard complete', press Ctrl+C to exit if it does not stop automatically."
echo

proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc "
    set -e
    cd '${REPO_ROOT}'

    # Ensure Node patch / env fixes are active for non-interactive shells
    if [ -f installer/ubuntu/env.sh ]; then
      source installer/ubuntu/env.sh
    fi
    
    openclaw onboard --skip-daemon ${*:-}
  "

#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "[clawbot] Entering Ubuntu and starting OpenClaw onboard..."
echo "[clawbot] When you see 'Onboard complete', press Ctrl+C to exit onboard."
echo

proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc "cd '${REPO_ROOT}' && openclaw onboard --skip-daemon"
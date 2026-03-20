#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU="ubuntu"

echo "[+] Updating Termux packages..."
pkg update -y
pkg upgrade -y

echo "[+] Installing prerequisites..."
pkg install -y proot-distro git curl termux-api android-tools

echo "[+] Installing proot Ubuntu (${UBUNTU}) if missing..."
UBUNTU_ROOTFS="/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu"
if [ ! -d "$UBUNTU_ROOTFS" ]; then
  echo "[install] Ubuntu not found, installing..."
  proot-distro install "$UBUNTU"
else
  echo "[install] Ubuntu already installed, skipping"
fi

echo "[+] Entering Ubuntu and running bootstrap..."
# Resolve repo root based on script location (assumes you run this from the repo)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Launch Ubuntu and run bootstrap inside it
proot-distro login "${UBUNTU}" --shared-tmp -- \
  bash -lc "cd '${REPO_ROOT}' && chmod +x installer/ubuntu/*.sh && ./installer/ubuntu/bootstrap.sh"

echo

echo
echo "[✓] Install finished."
echo
echo "Back in Termux, run the next steps from the project root:"
echo "  1) Run onboarding (interactive):"
echo "     ./installer/termux/onboard.sh"
echo
echo "  2) Start gateway anytime:"
echo "     ./installer/termux/run.sh"

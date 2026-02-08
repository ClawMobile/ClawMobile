#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU="ubuntu"

echo "[+] Updating Termux packages..."
pkg update -y
pkg upgrade -y

echo "[+] Installing prerequisites..."
pkg install -y proot-distro git curl termux-api android-tools

echo "[+] Installing proot Ubuntu (${UBUNTU}) if missing..."
if ! proot-distro list | grep -q "^${UBUNTU}\b"; then
  proot-distro install "${UBUNTU}"
else
  echo "    - ${UBUNTU} already installed."
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
echo "Next steps:"
echo "  1) Start gateway anytime:"
echo "     ${REPO_ROOT}/installer/termux/run.sh"
echo
echo "  2) Run onboarding to reconfigure when needed (interactive):"
echo "     ${REPO_ROOT}/installer/termux/onboard.sh"
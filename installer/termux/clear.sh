#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"

UBUNTU_ROOTFS="/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/${UBUNTU_DISTRO}"

echo "[clawmobile] Removing proot distro: ${UBUNTU_DISTRO}..."
if [ -d "${UBUNTU_ROOTFS}" ]; then
  proot-distro remove "${UBUNTU_DISTRO}"
  echo "[✓] Removed proot distro: ${UBUNTU_DISTRO}"
else
  echo "[i] Skip: proot distro '${UBUNTU_DISTRO}' not installed"
fi

echo
echo "[✓] Clear completed."

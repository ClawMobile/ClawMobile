#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "[clawmobile] Entering Ubuntu and running DroidRun setup..."
echo

proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc "
    set -e
    cd '${REPO_ROOT}'

    DROIDRUN_PORTAL_VERSION=\"\${DROIDRUN_PORTAL_VERSION:-0.6.1}\"
    DROIDRUN_PORTAL_APK_PATH=\"\${DROIDRUN_PORTAL_APK_PATH:-/tmp/droidrun-portal-v\${DROIDRUN_PORTAL_VERSION}.apk}\"
    export DROIDRUN_PORTAL_VERSION
    export DROIDRUN_PORTAL_APK_PATH

    if [ -f installer/ubuntu/env.sh ]; then
      source installer/ubuntu/env.sh
    fi

    if [ -f /root/venvs/clawmobile/bin/activate ]; then
      source /root/venvs/clawmobile/bin/activate
    elif [ -f /root/venvs/clawbot/bin/activate ]; then
      source /root/venvs/clawbot/bin/activate
    else
      echo '[droidrun-setup] ERROR: venv not found at /root/venvs/clawmobile or /root/venvs/clawbot' >&2
      exit 1
    fi

    ./installer/ubuntu/install-droidrun-portal.sh
  "

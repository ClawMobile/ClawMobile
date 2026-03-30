#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "[clawmobile] Entering Ubuntu and uninstalling DroidRun Portal..."
echo

proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- \
  bash -lc '
    set -e
    REPO_ROOT="$1"
    shift
    cd "$REPO_ROOT"

    if [ -f installer/ubuntu/env.sh ]; then
      source installer/ubuntu/env.sh
    fi

    ./installer/ubuntu/uninstall-droidrun-portal.sh "$@"
  ' -- "${REPO_ROOT}" "$@"

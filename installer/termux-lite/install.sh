#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

REPO_ROOT="$(clawmobile_lite_repo_root)"
PLUGIN_DIR="$REPO_ROOT/openclaw-plugin-mobile-ui"

clawmobile_require_termux
clawmobile_lite_env
clawmobile_termux_source_preflight

echo "[lite] Installing ClawMobile Termux runtime prerequisites..."
clawmobile_pkg update -y
clawmobile_pkg install -y git curl termux-api android-tools rsync

CLAWMOBILE_TERMUX_INSTALL_OCR="${CLAWMOBILE_TERMUX_INSTALL_OCR:-1}"
if [ "$CLAWMOBILE_TERMUX_INSTALL_OCR" = "1" ]; then
  echo "[lite] Installing OCR engine (tesseract)..."
  clawmobile_pkg install -y tesseract
else
  echo "[lite] Skipping OCR engine install (CLAWMOBILE_TERMUX_INSTALL_OCR=0)."
fi

if ! command -v openclaw >/dev/null 2>&1 && [ "${CLAWMOBILE_TERMUX_INSTALL_OPENCLAW:-0}" = "1" ]; then
  "$SCRIPT_DIR/install-openclaw.sh"
  clawmobile_lite_env
fi

clawmobile_require_openclaw
clawmobile_require_npm

clawmobile_build_plugin_lite "$REPO_ROOT"
clawmobile_install_plugin "$PLUGIN_DIR"
clawmobile_sync_workspace_seed "$REPO_ROOT"

echo
echo "[lite] Install complete."
echo "[lite] Next steps:"
echo "  ./installer/termux-lite/onboard.sh"
echo "  ./installer/termux-lite/run.sh"

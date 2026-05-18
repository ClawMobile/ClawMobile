#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

section() {
  echo
  echo "== $1 =="
}

clawmobile_require_termux
clawmobile_lite_env

section "openclaw"
if command -v openclaw >/dev/null 2>&1; then
  openclaw --version || true
else
  echo "missing"
fi

section "node/npm"
command -v node >/dev/null 2>&1 && node --version || echo "node missing"
command -v npm >/dev/null 2>&1 && npm --version || echo "npm missing"

section "adb"
if command -v adb >/dev/null 2>&1; then
  adb devices -l || true
else
  echo "adb missing"
fi

section "termux api"
for cmd in termux-toast termux-notification termux-clipboard-get termux-battery-status; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd present"
  else
    echo "$cmd missing"
  fi
done

section "ocr"
if command -v tesseract >/dev/null 2>&1; then
  tesseract --version 2>/dev/null | head -n 1 || true
  tesseract --list-langs 2>/dev/null || true
else
  echo "tesseract missing"
  echo "install: ./installer/termux-lite/install.sh"
  echo "skip during install: CLAWMOBILE_LITE_INSTALL_OCR=0 ./installer/termux-lite/install.sh"
fi

section "plugin"
if command -v openclaw >/dev/null 2>&1; then
  openclaw plugins list || true
fi

section "skills"
if command -v openclaw >/dev/null 2>&1; then
  openclaw skills list || true
  openclaw skills check || true
fi

section "environment"
echo "CLAWMOBILE_LITE=${CLAWMOBILE_LITE:-}"
echo "CLAW_MOBILE_ADB_ONLY=${CLAW_MOBILE_ADB_ONLY:-}"
echo "OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR:-}"
echo "OPENCLAW_WORKSPACE=${OPENCLAW_WORKSPACE:-}"
echo "CLAWDHUB_WORKDIR=${CLAWDHUB_WORKDIR:-}"

section "workspace seed"
workspace="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
if command -v openclaw >/dev/null 2>&1; then
  configured="$(openclaw config get agents.defaults.workspace 2>/dev/null | tr -d '"' || true)"
  if [ -n "$configured" ] && [ "$configured" != "null" ]; then
    workspace="$configured"
  fi
fi
echo "workspace=$workspace"
[ -f "$workspace/AGENTS.md" ] && echo "AGENTS.md present" || echo "AGENTS.md missing"
[ -f "$workspace/TOOLS.md" ] && echo "TOOLS.md present" || echo "TOOLS.md missing"
if [ -d "$workspace/skills" ]; then
  find "$workspace/skills" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort
else
  echo "skills missing"
fi

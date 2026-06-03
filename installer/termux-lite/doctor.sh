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

section "termux app"
termux_installer="$(clawmobile_termux_installer_package)"
termux_version="$(clawmobile_termux_version)"
termux_apk_release="$(clawmobile_termux_apk_release)"
termux_source_kind="$(clawmobile_termux_source_kind "$termux_installer" "$termux_apk_release")"
termux_source_label="$(clawmobile_termux_source_label "$termux_source_kind")"
echo "source=$termux_source_label"
echo "source_kind=$termux_source_kind"
echo "installer=$termux_installer"
echo "apk_release=$termux_apk_release"
echo "version=$termux_version"
echo "prefix=${PREFIX:-}"
if [ "$termux_source_kind" = "google_play" ]; then
  echo "warning=Google Play Termux is best-effort only; use F-Droid or official GitHub Termux for supported installs."
fi

section "termux package sources"
if [ -f "${PREFIX:-}/etc/apt/sources.list" ]; then
  sed -n '1,5p' "$PREFIX/etc/apt/sources.list"
else
  echo "sources.list missing"
fi

section "termux package availability"
if command -v apt-cache >/dev/null 2>&1; then
  for pkg in git curl termux-api android-tools tesseract; do
    installed="$(apt-cache policy "$pkg" 2>/dev/null | sed -n 's/^[[:space:]]*Installed: //p' | head -n 1 || true)"
    candidate="$(apt-cache policy "$pkg" 2>/dev/null | sed -n 's/^[[:space:]]*Candidate: //p' | head -n 1 || true)"
    echo "$pkg installed=${installed:-unknown} candidate=${candidate:-unknown}"
  done
else
  echo "apt-cache missing"
fi

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
  echo "skip during install: CLAWMOBILE_TERMUX_INSTALL_OCR=0 ./installer/termux-lite/install.sh"
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

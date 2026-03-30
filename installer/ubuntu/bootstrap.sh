#!/usr/bin/env bash
set -euo pipefail

# Pinned install versions. You can override them at runtime, for example:
#   OPENCLAW_VERSION=2026.3.13 DROIDRUN_VERSION=0.5.1 DROIDRUN_PORTAL_VERSION=0.6.1 ./installer/termux/install.sh
OPENCLAW_VERSION="${OPENCLAW_VERSION:-2026.3.13}"
DROIDRUN_VERSION="${DROIDRUN_VERSION:-0.5.1}"
DROIDRUN_PORTAL_VERSION="${DROIDRUN_PORTAL_VERSION:-0.6.1}"
DROIDRUN_PORTAL_APK_PATH="${DROIDRUN_PORTAL_APK_PATH:-/tmp/droidrun-portal-v${DROIDRUN_PORTAL_VERSION}.apk}"
export DROIDRUN_PORTAL_VERSION
export DROIDRUN_PORTAL_APK_PATH

echo "[+] Updating apt..."
apt update -y

echo "[+] Installing base dependencies..."
# python3-venv/python3-pip: Debian/Ubuntu 正确 pip 方式（避免 ensurepip 缺失问题）
# nodejs/npm: OpenClaw/插件常用
apt install -y \
  android-tools-adb \
  python3 python3-venv python3-pip \
  curl rsync

echo "[+] Creating venv for ClawMobile/OpenClaw tooling..."
mkdir -p /root/venvs
if [[ ! -d /root/venvs/clawmobile ]]; then
  python3 -m venv /root/venvs/clawmobile
fi

# Activate venv
# shellcheck disable=SC1091
source /root/venvs/clawmobile/bin/activate

echo "[+] Upgrading pip toolchain in venv..."
python -m pip install --upgrade pip

echo "[+] Installing DroidRun ${DROIDRUN_VERSION} (pip, no uv)..."
# If you want extras, change [openai] to what you need.
python -m pip install \
  "droidrun[google,anthropic,openai,deepseek,ollama,openrouter]==${DROIDRUN_VERSION}"

./installer/ubuntu/install-droidrun-portal.sh

echo "[+] Verifying droidrun import..."
droidrun ping


# Apply env hardening (cache/tmp inside venv)
# Assumes this script runs from repo root OR you can adjust path
if [[ -f "installer/ubuntu/env.sh" ]]; then
  # shellcheck disable=SC1091
  source "installer/ubuntu/env.sh"
else
  echo "[!] installer/ubuntu/env.sh not found in current directory."
  echo "    Please run bootstrap.sh from the repo root."
  exit 1
fi

echo
echo "[*] OpenClaw installation"
echo

echo "[+] Installing OpenClaw ${OPENCLAW_VERSION}..."
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard --version "${OPENCLAW_VERSION}"


echo "[✓] Bootstrap complete."

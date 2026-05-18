#!/usr/bin/env bash
set -euo pipefail

# Pinned install versions. You can override them at runtime, for example:
#   OPENCLAW_VERSION=2026.3.13 DROIDRUN_VERSION=0.5.1 DROIDRUN_PORTAL_VERSION=0.6.1 ./installer/termux/install.sh
OPENCLAW_VERSION="${OPENCLAW_VERSION:-2026.3.13}"
DROIDRUN_VERSION="${DROIDRUN_VERSION:-0.5.1}"
DROIDRUN_PORTAL_VERSION="${DROIDRUN_PORTAL_VERSION:-0.6.1}"
DROIDRUN_PORTAL_APK_PATH="${DROIDRUN_PORTAL_APK_PATH:-/tmp/droidrun-portal-v${DROIDRUN_PORTAL_VERSION}.apk}"
DROIDRUN_PIP_INDEX_URL="${DROIDRUN_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
DROIDRUN_PIP_TIMEOUT="${DROIDRUN_PIP_TIMEOUT:-300}"
DROIDRUN_PIP_RETRIES="${DROIDRUN_PIP_RETRIES:-5}"
DROIDRUN_MOBILERUN_SDK_SPEC="${DROIDRUN_MOBILERUN_SDK_SPEC:-mobilerun-sdk==2.1.0}"
DROIDRUN_PIP_NETWORK_ARGS=(
  -i "${DROIDRUN_PIP_INDEX_URL}"
  --timeout "${DROIDRUN_PIP_TIMEOUT}"
  --retries "${DROIDRUN_PIP_RETRIES}"
)
export DROIDRUN_PORTAL_VERSION
export DROIDRUN_PORTAL_APK_PATH

install_droidrun() {
  local pip_args=(
    --use-deprecated=legacy-resolver
    "${DROIDRUN_PIP_NETWORK_ARGS[@]}"
  )

  echo "[+] Installing DroidRun ${DROIDRUN_VERSION} (pip, no uv)..."
  echo "[+] Using pip index: ${DROIDRUN_PIP_INDEX_URL}"
  echo "[+] Installing DroidRun compatibility dependency: ${DROIDRUN_MOBILERUN_SDK_SPEC}"
  python -m pip install "${pip_args[@]}" \
    "${DROIDRUN_MOBILERUN_SDK_SPEC}" \
    "droidrun[google,anthropic,openai,deepseek,ollama,openrouter]==${DROIDRUN_VERSION}"

  echo "[+] Verifying DroidRun CLI imports..."
  python -c "from droidrun.cli.main import cli; print('droidrun cli import ok')"
}

echo "[+] Updating apt..."
apt update -y

echo "[+] Installing base dependencies..."
# python3-venv/python3-pip: use Debian/Ubuntu packages instead of ensurepip.
# nodejs/npm: used by OpenClaw and plugin tooling.
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
python -m pip install "${DROIDRUN_PIP_NETWORK_ARGS[@]}" --upgrade pip

install_droidrun

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

#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${DROIDRUN_PORTAL_PACKAGE:-com.droidrun.portal}"
DROIDRUN_PORTAL_VERSION="${DROIDRUN_PORTAL_VERSION:-0.6.1}"
DROIDRUN_PORTAL_APK_PATH="${DROIDRUN_PORTAL_APK_PATH:-/tmp/droidrun-portal-v${DROIDRUN_PORTAL_VERSION}.apk}"

echo "[portal-install] Checking adb..."
if ! command -v adb >/dev/null 2>&1; then
  echo "[portal-install] ERROR: adb not found in PATH" >&2
  exit 1
fi

get_installed_version() {
  if ! adb shell pm list packages "${PACKAGE_NAME}" 2>/dev/null | tr -d '\r' | grep -q "^package:${PACKAGE_NAME}\$"; then
    return 1
  fi

  adb shell dumpsys package "${PACKAGE_NAME}" 2>/dev/null \
    | tr -d '\r' \
    | sed -n 's/^[[:space:]]*versionName=//p' \
    | head -n 1
}

download_portal_apk() {
  local primary_url fallback_url
  primary_url="https://github.com/droidrun/droidrun-portal/releases/download/v${DROIDRUN_PORTAL_VERSION}/droidrun-portal-v${DROIDRUN_PORTAL_VERSION}.apk"
  fallback_url="https://github.com/droidrun/droidrun-portal/releases/download/v${DROIDRUN_PORTAL_VERSION}/app-release.apk"

  echo "[portal-install] Downloading DroidRun Portal ${DROIDRUN_PORTAL_VERSION}..."
  mkdir -p "$(dirname "${DROIDRUN_PORTAL_APK_PATH}")"

  if curl -fL "${primary_url}" -o "${DROIDRUN_PORTAL_APK_PATH}"; then
    echo "[portal-install] Downloaded portal APK from tagged release asset."
    return 0
  fi

  if curl -fL "${fallback_url}" -o "${DROIDRUN_PORTAL_APK_PATH}"; then
    echo "[portal-install] Downloaded portal APK from fallback release asset."
    return 0
  fi

  echo "[portal-install] ERROR: failed to download DroidRun Portal ${DROIDRUN_PORTAL_VERSION}." >&2
  echo "[portal-install] Tried: ${primary_url}" >&2
  echo "[portal-install] Tried: ${fallback_url}" >&2
  exit 1
}

INSTALLED_VERSION="$(get_installed_version || true)"

if [ -n "${INSTALLED_VERSION}" ]; then
  echo "[portal-install] Installed portal version: ${INSTALLED_VERSION}"
  if [ "${INSTALLED_VERSION}" = "${DROIDRUN_PORTAL_VERSION}" ]; then
    echo "[portal-install] Target version already installed; skipping reinstall."
    exit 0
  fi

  echo "[portal-install] Target version ${DROIDRUN_PORTAL_VERSION} differs; uninstalling ${PACKAGE_NAME} first."
  ./installer/ubuntu/uninstall-droidrun-portal.sh
else
  echo "[portal-install] Portal not currently installed."
fi

download_portal_apk

echo "[portal-install] Installing DroidRun Portal ${DROIDRUN_PORTAL_VERSION}..."
droidrun setup --path "${DROIDRUN_PORTAL_APK_PATH}"

#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${DROIDRUN_PORTAL_PACKAGE:-com.droidrun.portal}"

echo "[portal-uninstall] Checking adb..."
if ! command -v adb >/dev/null 2>&1; then
  echo "[portal-uninstall] ERROR: adb not found in PATH" >&2
  exit 1
fi

echo "[portal-uninstall] Looking for installed package: ${PACKAGE_NAME}"
if ! adb shell pm list packages "${PACKAGE_NAME}" 2>/dev/null | grep -q "^package:${PACKAGE_NAME}\$"; then
  echo "[portal-uninstall] Package not installed: ${PACKAGE_NAME}"
  exit 0
fi

echo "[portal-uninstall] Uninstalling ${PACKAGE_NAME}..."
UNINSTALL_OUT="$(adb uninstall "${PACKAGE_NAME}" 2>&1 || true)"
echo "${UNINSTALL_OUT}"

if echo "${UNINSTALL_OUT}" | grep -q "Success"; then
  echo "[portal-uninstall] Uninstall complete."
  exit 0
fi

echo "[portal-uninstall] ERROR: uninstall failed." >&2
exit 1

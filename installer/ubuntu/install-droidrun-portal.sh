#!/usr/bin/env bash
set -euo pipefail

DROIDRUN_PORTAL_VERSION="${DROIDRUN_PORTAL_VERSION:-0.6.1}"
APK_URL="https://github.com/droidrun/droidrun-portal/releases/download/v${DROIDRUN_PORTAL_VERSION}/droidrun-portal-v${DROIDRUN_PORTAL_VERSION}.apk"
SHA_URL="${APK_URL}.sha256"
APK_PATH="${DROIDRUN_PORTAL_APK_PATH:-/tmp/droidrun-portal-v${DROIDRUN_PORTAL_VERSION}.apk}"
SHA_PATH="${APK_PATH}.sha256"

curl -fL "$APK_URL" -o "$APK_PATH"
curl -fL "$SHA_URL" -o "$SHA_PATH"
sha256sum -c "$SHA_PATH"

# Stronger option if available:
# apksigner verify --print-certs "$APK_PATH"
# Compare the signing certificate fingerprint to a pinned expected value.

droidrun setup --path "$APK_PATH"

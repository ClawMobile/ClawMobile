#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_VERSION="${OPENCLAW_VERSION:-2026.3.13}"
INSTALL_URL="https://openclaw.ai/releases/${OPENCLAW_VERSION}/install.sh"
SHA_URL="${INSTALL_URL}.sha256"
TMP_SCRIPT="$(mktemp)"
TMP_SHA="$(mktemp)"
trap 'rm -f "$TMP_SCRIPT" "$TMP_SHA"' EXIT

curl -fsSL "$INSTALL_URL" -o "$TMP_SCRIPT"
curl -fsSL "$SHA_URL" -o "$TMP_SHA"
EXPECTED_SHA="$(cut -d' ' -f1 "$TMP_SHA")"
ACTUAL_SHA="$(sha256sum "$TMP_SCRIPT" | cut -d' ' -f1)"

if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo '[bootstrap] ERROR: OpenClaw installer checksum mismatch' >&2
  exit 1
fi

bash "$TMP_SCRIPT" --no-onboard --version "$OPENCLAW_VERSION"

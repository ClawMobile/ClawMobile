#!/usr/bin/env bash
set -euo pipefail
pkill -f "openclaw gateway" || true
rm -rf "${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
echo "OpenClaw state cleared."
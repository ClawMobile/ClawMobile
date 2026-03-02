#!/usr/bin/env bash
set -u

STATUS=0

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; STATUS=1; }
section() { echo ""; echo "== $* =="; }

# 1) openclaw available
section "openclaw"
if command -v openclaw >/dev/null 2>&1; then
  VERSION=$(openclaw --version 2>/dev/null || true)
  if [ -n "$VERSION" ]; then
    pass "openclaw available: $VERSION"
  else
    fail "openclaw exists but --version failed"
  fi
else
  fail "openclaw not found in PATH"
fi

# 2) plugin installed
section "plugin"
if command -v openclaw >/dev/null 2>&1; then
  if openclaw plugins list >/dev/null 2>&1; then
    PLUGINS=$(openclaw plugins list 2>/dev/null | head -n 20)
    if echo "$PLUGINS" | grep -n "openclaw-plugin-mobile-ui" >/dev/null 2>&1; then
      pass "plugin installed (openclaw-plugin-mobile-ui)"
    else
      fail "plugin not listed (openclaw-plugin-mobile-ui)"
      echo "  plugins (first 20 lines):"
      echo "$PLUGINS" | sed -n '1,20p'
    fi
  else
    fail "openclaw plugins list failed"
  fi
else
  fail "openclaw unavailable, cannot check plugin"
fi

# 3) adb available + devices output
section "adb"
if command -v adb >/dev/null 2>&1; then
  pass "adb available"
  ADB_DEV=$(adb devices -l 2>/dev/null | head -n 20)
  echo "adb devices (first 20 lines):"
  echo "$ADB_DEV"
else
  fail "adb not found in PATH"
fi

# 4) portal state query
section "droidrun portal"
if command -v adb >/dev/null 2>&1; then
  PORTAL_OUT=$(adb shell content query --uri content://com.droidrun.portal/state 2>/dev/null | head -n 20)
  if [ -n "$PORTAL_OUT" ]; then
    pass "portal state query returned data"
    echo "portal state (first 20 lines):"
    echo "$PORTAL_OUT"
  else
    fail "portal state query returned no data (is portal running?)"
  fi
else
  fail "adb unavailable; cannot query portal"
fi

# 5) python venv import droidrun
section "python droidrun"
if [ -f "/root/venvs/clawbot/bin/activate" ]; then
  # shellcheck disable=SC1091
  source /root/venvs/clawbot/bin/activate
  pass "activated venv: /root/venvs/clawbot"
else
  fail "venv not found: /root/venvs/clawbot/bin/activate"
fi

PY=${CLAW_MOBILE_PYTHON:-python3}
if command -v "$PY" >/dev/null 2>&1; then
  if "$PY" -c "import droidrun; print('ok')" >/dev/null 2>&1; then
    pass "droidrun import OK via $PY"
  else
    fail "droidrun import failed via $PY"
  fi
else
  fail "python not found: $PY"
fi

# 6) termux-api availability
section "termux-api"
TERMUX_BIN=${CLAW_MOBILE_TERMUX_BIN:-/data/data/com.termux/files/usr/bin}
if [ -x "$TERMUX_BIN/termux-notification" ] || [ -x "$TERMUX_BIN/termux-info" ] || command -v termux-notification >/dev/null 2>&1; then
  pass "termux-api available"
else
  fail "termux-api not found (install pkg termux-api and Termux:API app from F-Droid)"
fi

exit $STATUS

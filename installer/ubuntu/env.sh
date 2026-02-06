#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   source installer/ubuntu/env.sh
# Optional:
#   source /root/venvs/clawbot/bin/activate
#   source installer/ubuntu/env.sh

echo "[env] Applying OpenClaw/Node patches for Android/proot..."

# ---- Patch: Disable network interface scan crashes ----
# Some Node tooling calls os.networkInterfaces() and may crash or misbehave in proot.
# This patch makes networkInterfaces() return {} on error.
PATCH_JS="/root/patch-netif.js"
cat > "${PATCH_JS}" <<'EOF'
try {
  const os = require('os');
  const old = os.networkInterfaces;
  os.networkInterfaces = () => {
    try { return old(); } catch (e) { return {}; }
  };
} catch (e) {}
EOF

export NODE_OPTIONS="--require=${PATCH_JS} ${NODE_OPTIONS:-}"
echo "[env] NODE_OPTIONS=${NODE_OPTIONS}"

# # ---- Optional: Python venv cache/tmp hardening (safe even if not needed now) ----
# # If you later install Python deps, this prevents Android filesystem/cache issues.
# if [[ -n "${VIRTUAL_ENV:-}" ]]; then
#   mkdir -p "${VIRTUAL_ENV}/.cache/pip" "${VIRTUAL_ENV}/.cache/tmp" "${VIRTUAL_ENV}/.cache/uv"
#   export XDG_CACHE_HOME="${VIRTUAL_ENV}/.cache"
#   export PIP_CACHE_DIR="${XDG_CACHE_HOME}/pip"
#   export TMPDIR="${XDG_CACHE_HOME}/tmp"
#   export PATH="${VIRTUAL_ENV}/bin:${PATH}"
#   echo "[env] Python venv detected: ${VIRTUAL_ENV}"
#   echo "[env] XDG_CACHE_HOME=${XDG_CACHE_HOME}"
#   echo "[env] TMPDIR=${TMPDIR}"
# fi

# ---- Optional: persist to .bashrc for future shells ----
# This block only appends once (idempotent).
BASHRC="/root/.bashrc"
MARKER_BEGIN="# >>> clawbot-mobile env begin >>>"
MARKER_END="# <<< clawbot-mobile env end <<<"

if ! grep -qF "${MARKER_BEGIN}" "${BASHRC}" 2>/dev/null; then
  cat >> "${BASHRC}" <<EOF

${MARKER_BEGIN}
# Auto-enable Node patch to avoid os.networkInterfaces issues in proot/Android
if [ -f "${PATCH_JS}" ]; then
  export NODE_OPTIONS="--require=${PATCH_JS} \${NODE_OPTIONS:-}"
fi
${MARKER_END}
EOF
  echo "[env] Installed persistent NODE_OPTIONS patch into ${BASHRC}"
else
  echo "[env] ${BASHRC} already has persistent patch block."
fi
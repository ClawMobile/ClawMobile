#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_BIND="${GATEWAY_BIND:-loopback}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# 你的规则目录：如果你实际是 memory/，就把 rules 改成 memory
REPO_RULES="${REPO_ROOT}/rules"

echo "[clawbot] Starting OpenClaw Gateway..."
proot-distro login "${UBUNTU_DISTRO}" --shared-tmp -- bash -lc "
  set -euo pipefail

  REPO_ROOT='${REPO_ROOT}'
  REPO_RULES='${REPO_RULES}'

  cd \"\$REPO_ROOT\"

  # ---- ensure env.sh patch also loads (node netif patch) ----
  if [ -f installer/ubuntu/env.sh ]; then
    source installer/ubuntu/env.sh
  fi

  # ---- activate python virtual environment ----
  # 推荐：不要只 activate，还要显式指定 CLAW_MOBILE_PYTHON，避免 openclaw worker PATH 重置
  if [ -f \"\$REPO_ROOT/.venv/bin/activate\" ]; then
    source \"\$REPO_ROOT/.venv/bin/activate\"
    if [ -x \"\$REPO_ROOT/.venv/bin/python3\" ]; then
      export CLAW_MOBILE_PYTHON=\"\$REPO_ROOT/.venv/bin/python3\"
    else
      export CLAW_MOBILE_PYTHON=\"\$REPO_ROOT/.venv/bin/python\"
    fi
  else
    echo \"[run] WARNING: venv not found at \$REPO_ROOT/.venv; tools may use system python\"
  fi

  echo \"[run] CLAW_MOBILE_PYTHON=\${CLAW_MOBILE_PYTHON:-}\" || true

  # ---- configure external rules for memory_search (read-only) ----
  if [ -d \"\$REPO_RULES\" ]; then
    openclaw config set agents.defaults.memorySearch.extraPaths \"[\\\"\$REPO_RULES\\\"]\" >/dev/null 2>&1 || true
    echo \"[run] memorySearch.extraPaths set to: \$REPO_RULES\"
  else
    echo \"[run] rules folder not found at \$REPO_RULES (ok)\"
  fi

  exec openclaw gateway --bind ${GATEWAY_BIND} --port ${GATEWAY_PORT} --verbose
"
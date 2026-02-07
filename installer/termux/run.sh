#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

UBUNTU_DISTRO="${UBUNTU_DISTRO:-ubuntu}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_BIND="${GATEWAY_BIND:-loopback}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# 你的规则目录：如果你实际是 memory/，就把 rules 改成 memory
REPO_RULES="${REPO_ROOT}/memory"

# ---- auto-pick droidrun provider/model from exported API keys ----
# Order follows DroidRun docs: Gemini (default) -> OpenAI -> Anthropic -> DeepSeek -> Ollama(local)
# Env var names per DroidRun quickstart.
pick_droidrun_llm() {
  # allow user override
  if [ -n "${DROIDRUN_PROVIDER:-}" ] && [ -n "${DROIDRUN_MODEL:-}" ]; then
    return 0
  fi

  if [ -n "${GEMINI_API_KEY:-}" ]; then
    export DROIDRUN_PROVIDER="${DROIDRUN_PROVIDER:-Gemini}"
    export DROIDRUN_MODEL="${DROIDRUN_MODEL:-gemini-2.5-flash}"
    return 0
  fi

  if [ -n "${OPENAI_API_KEY:-}" ]; then
    export DROIDRUN_PROVIDER="${DROIDRUN_PROVIDER:-OpenAI}"
    export DROIDRUN_MODEL="${DROIDRUN_MODEL:-gpt-4o-mini}"
    return 0
  fi

  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    export DROIDRUN_PROVIDER="${DROIDRUN_PROVIDER:-Anthropic}"
    export DROIDRUN_MODEL="${DROIDRUN_MODEL:-claude-3-5-sonnet-latest}"
    return 0
  fi

  if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
    export DROIDRUN_PROVIDER="${DROIDRUN_PROVIDER:-DeepSeek}"
    export DROIDRUN_MODEL="${DROIDRUN_MODEL:-deepseek-chat}"
    return 0
  fi

  # Ollama: no API key needed, but should be reachable
  if command -v ollama >/dev/null 2>&1; then
    export DROIDRUN_PROVIDER="${DROIDRUN_PROVIDER:-Ollama}"
    export DROIDRUN_MODEL="${DROIDRUN_MODEL:-llama3}"
    return 0
  fi

  return 1
}

if pick_droidrun_llm; then
  echo "[run] droidrun llm: provider=${DROIDRUN_PROVIDER} model=${DROIDRUN_MODEL}"
else
  echo "[run] WARNING: No LLM API key found for droidrun (need one of GEMINI_API_KEY/OPENAI_API_KEY/ANTHROPIC_API_KEY/DEEPSEEK_API_KEY, or ollama)."
fi

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
  # 推荐：不要只 activate, 还要显式指定 CLAW_MOBILE_PYTHON, 避免 openclaw worker PATH 重置
  if [ -f \"/root/venvs/clawbot/bin/activate\" ]; then
    source \"/root/venvs/clawbot/bin/activate\"
    if [ -x \"/root/venvs/clawbot/bin/python3\" ]; then
      export CLAW_MOBILE_PYTHON=\"/root/venvs/clawbot/bin/python3\"
    else
      export CLAW_MOBILE_PYTHON=\"/root/venvs/clawbot/bin/python\"
    fi
  else
    echo \"[run] WARNING: venv not found at /root/venvs/clawbot; tools may use system python\"
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
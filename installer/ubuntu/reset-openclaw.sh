#!/usr/bin/env bash
set -euo pipefail

# reset-openclaw.sh
#
# Reset OpenClaw state with different levels, useful for testing memory/workspace seeding.
#
# Levels:
#   soft     Stop gateway only (default)
#   workspace Clear only workspace content that affects memory/bootstrap (AGENTS/TOOLS/rules/workspace cache)
#   state    Clear OpenClaw state dir
#   full     Clear both state dir and workspace
#
# Options:
#   --level <soft|workspace|state|full>
#   --state-dir <path>        Override state dir (default: OPENCLAW_STATE_DIR or $HOME/.openclaw)
#   --workspace <path>        Override workspace path (default: from openclaw config or $HOME/.openclaw/workspace)
#   --dry-run                 Print actions without executing
#
# Notes:
# - "state" is usually ~/.openclaw (config/cache/indexes)
# - "workspace" is where AGENTS.md/TOOLS.md/rules live (and where you seed files)
# - For memory injection testing, "workspace" level is usually what you want.

LEVEL="soft"
DRY_RUN=0

STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
WORKSPACE_OVERRIDE=""

usage() {
  cat <<'USAGE'
Usage:
  reset-openclaw.sh [--level soft|workspace|state|full] [--dry-run]
                    [--state-dir PATH] [--workspace PATH]

Examples:
  # stop gateway only
  ./reset-openclaw.sh

  # reset injected memory/bootstrap files but keep openclaw config
  ./reset-openclaw.sh --level workspace

  # wipe ~/.openclaw (cache/config/index), but keep workspace content
  ./reset-openclaw.sh --level state

  # wipe everything (nuclear)
  ./reset-openclaw.sh --level full
USAGE
}

log() { echo "[reset] $*"; }

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] $*"
  else
    eval "$@"
  fi
}

# Parse args
while [ $# -gt 0 ]; do
  case "$1" in
    --level)
      LEVEL="${2:-}"; shift 2;;
    --state-dir)
      STATE_DIR="${2:-}"; shift 2;;
    --workspace)
      WORKSPACE_OVERRIDE="${2:-}"; shift 2;;
    --dry-run)
      DRY_RUN=1; shift;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2;;
  esac
done

case "$LEVEL" in
  soft|workspace|state|full) ;;
  *)
    echo "Invalid --level: $LEVEL" >&2
    usage
    exit 2
    ;;
esac

# Stop gateway (best-effort)
log "Stopping openclaw gateway (best-effort)..."
run "pkill -f 'openclaw gateway' >/dev/null 2>&1 || true"
run "pkill -f 'openclaw.*gateway' >/dev/null 2>&1 || true"

# Resolve workspace path:
# Prefer:
#  1) --workspace override
#  2) openclaw config get agents.defaults.workspace (if openclaw exists)
#  3) default $STATE_DIR/workspace
WORKSPACE="$WORKSPACE_OVERRIDE"
if [ -z "$WORKSPACE" ]; then
  if command -v openclaw >/dev/null 2>&1; then
    # Might print quoted string; trim quotes.
    WORKSPACE="$(openclaw config get agents.defaults.workspace 2>/dev/null | tr -d '"' || true)"
  fi
fi
if [ -z "$WORKSPACE" ]; then
  WORKSPACE="$STATE_DIR/workspace"
fi

log "Level: $LEVEL"
log "State dir: $STATE_DIR"
log "Workspace: $WORKSPACE"

reset_workspace() {
  # Remove only what affects your injected behavior/tests:
  # - AGENTS.md / TOOLS.md: bootstrap instructions
  # - rules/Clawbot-mobile: seeded rules (keep rules/user)
  # - optional workspace caches/logs you might create
  log "Resetting workspace (bootstrap + seeded rules) ..."

  # Bootstrap files
  run "rm -f '$WORKSPACE/AGENTS.md' '$WORKSPACE/TOOLS.md' '$WORKSPACE/BOOTSTRAP.md' '$WORKSPACE/USER.md' '$WORKSPACE/SOUL.md' 2>/dev/null || true"

  # Seeded rules folder (overwriteable). Keep user rules.
  run "rm -rf '$WORKSPACE/rules/Clawbot-mobile' 2>/dev/null || true"
  run "mkdir -p '$WORKSPACE/rules/user' 2>/dev/null || true"

  # If you keep any project-generated caches in workspace:
  run "rm -rf '$WORKSPACE/.cache' '$WORKSPACE/tmp' '$WORKSPACE/.openclaw-cache' 2>/dev/null || true"

  log "Workspace reset complete."
}

reset_state() {
  log "Resetting OpenClaw state dir (config/cache/indexes) ..."
  # Be careful: this may remove onboard configuration if stored under state dir.
  run "rm -rf '$STATE_DIR' 2>/dev/null || true"
  log "State dir reset complete."
}

case "$LEVEL" in
  soft)
    log "Done (soft reset)."
    ;;
  workspace)
    reset_workspace
    log "Done (workspace reset)."
    ;;
  state)
    reset_state
    log "Done (state reset)."
    ;;
  full)
    run "openclaw uninstall --all --yes --non-interactive || true"
    run "npm rm -g openclaw || true"
    log "Done (full reset)."
    ;;
esac
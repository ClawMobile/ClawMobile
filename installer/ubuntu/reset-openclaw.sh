#!/usr/bin/env bash
set -euo pipefail

# reset-openclaw.sh
#
# Reset OpenClaw state with different levels, useful for testing workspace seeding.
#
# Levels:
#   soft     Stop gateway only (default)
#   workspace Clear seeded workspace content (AGENTS/TOOLS/skills/cache)
#   state    Clear OpenClaw state dir and plugin build output
#   full     Remove global OpenClaw CLI and clear state/workspace
#
# Options:
#   --level <soft|workspace|state|full>
#   --state-dir <path>        Override state dir (default: OPENCLAW_STATE_DIR or $HOME/.openclaw)
#   --workspace <path>        Override workspace path (default: from openclaw config or $HOME/.openclaw/workspace)
#   --dry-run                 Print actions without executing
#
# Notes:
# - "state" is usually ~/.openclaw (config/cache/indexes)
# - "workspace" is where AGENTS.md/TOOLS.md/skills live (and where you seed files)
# - For seed testing, "workspace" level is usually what you want.

LEVEL="soft"
DRY_RUN=0

STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
WORKSPACE_OVERRIDE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PLUGIN_DIR="${REPO_ROOT}/openclaw-plugin-mobile-ui"

usage() {
  cat <<'USAGE'
Usage:
  reset-openclaw.sh [--level soft|workspace|state|full] [--dry-run]
                    [--state-dir PATH] [--workspace PATH]

Examples:
  # stop gateway only
  ./reset-openclaw.sh

  # reset injected workspace seed files but keep openclaw config
  ./reset-openclaw.sh --level workspace

  # wipe ~/.openclaw (cache/config/index), but keep workspace content
  ./reset-openclaw.sh --level state

  # remove the global OpenClaw CLI and wipe local state/workspace
  ./reset-openclaw.sh --level full
USAGE
}

log() { echo "[reset] $*"; }

print_dry_run() {
  local rendered
  rendered="$(printf '%q ' "$@")"
  echo "[dry-run] ${rendered% }"
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    print_dry_run "$@"
    return 0
  fi
  "$@"
}

run_best_effort() {
  if [ "$DRY_RUN" -eq 1 ]; then
    print_dry_run "$@" '||' true
    return 0
  fi
  "$@" || true
}

run_best_effort_quiet() {
  if [ "$DRY_RUN" -eq 1 ]; then
    print_dry_run "$@" '>/dev/null' '2>&1' '||' true
    return 0
  fi
  "$@" >/dev/null 2>&1 || true
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
run_best_effort_quiet pkill -f "openclaw gateway"
run_best_effort_quiet pkill -f "openclaw.*gateway"

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

reset_plugin_build() {
  if [ -d "$PLUGIN_DIR/dist" ]; then
    log "Removing plugin build output at $PLUGIN_DIR/dist ..."
    run_cmd rm -rf -- "$PLUGIN_DIR/dist"
  else
    log "Plugin build output already clean."
  fi
}

clean_seeded_prompt_file() {
  local file="$1"
  local begin_marker="CLAWMOBILE_BEGIN"
  local end_marker="CLAWMOBILE_END"

  # If dry-run, just report what would happen.
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ -f "$file" ] && grep -q "$begin_marker" "$file"; then
      # Verify that an END marker exists after the BEGIN marker.
      local begin_line end_line
      begin_line=$(grep -n "$begin_marker" "$file" | head -n1 | cut -d: -f1 || true)
      end_line=$(grep -n "$end_marker" "$file" | head -n1 | cut -d: -f1 || true)
      if [ -n "${begin_line:-}" ] && [ -n "${end_line:-}" ] && [ "$end_line" -gt "$begin_line" ]; then
        echo "[DRY-RUN] Would remove mobile seeded block from '$file'"
      else
        echo "[DRY-RUN] Found mobile seeded block marker but missing or misordered end marker in '$file'; would skip cleanup to avoid truncating content"
      fi
    else
      echo "[DRY-RUN] No mobile seeded block found in '$file'; nothing to do"
    fi
    return 0
  fi

  # If the file doesn't exist, nothing to clean.
  if [ ! -f "$file" ]; then
    return 0
  fi

  # If there's no seeded block marker, leave the file untouched.
  if ! grep -q "$begin_marker" "$file"; then
    return 0
  fi

  # Ensure there is a matching END marker after the BEGIN marker to avoid truncating content.
  local begin_line end_line
  begin_line=$(grep -n "$begin_marker" "$file" | head -n1 | cut -d: -f1 || true)
  end_line=$(grep -n "$end_marker" "$file" | head -n1 | cut -d: -f1 || true)
  if [ -z "${end_line:-}" ] || [ -z "${begin_line:-}" ] || [ "$end_line" -le "$begin_line" ]; then
    echo "WARNING: Skipping mobile seeded block cleanup for '$file' because the end marker is missing or appears before the begin marker." >&2
    return 0
  fi

  local tmp="${file}.tmp.reset"

  # Strip lines between the mobile begin and end markers (exclusive).
  awk -v begin_marker="$begin_marker" -v end_marker="$end_marker" '
index($0, begin_marker) {inblock=1; next}
index($0, end_marker) {inblock=0; next}
!inblock {print}
' "$file" > "$tmp"

  # If the resulting file is empty or only whitespace, delete the original.
  if [ ! -s "$tmp" ] || ! grep -q '[^[:space:]]' "$tmp"; then
    rm -f "$file" "$tmp"
  else
    mv "$tmp" "$file"
  fi
}

reset_workspace() {
  # Remove only files seeded by installer/workspace-seed plus local caches.
  log "Resetting workspace seed files ..."

  # Seeded prompt files: remove only mobile seeded blocks.
  clean_seeded_prompt_file "$WORKSPACE/AGENTS.md"
  clean_seeded_prompt_file "$WORKSPACE/TOOLS.md"

  # Seeded skills copied from installer/workspace-seed/skills.
  run_best_effort rm -rf -- "$WORKSPACE/skills/clawmobile-capabilities" "$WORKSPACE/skills/clawmobile-policy"

  # If you keep any project-generated caches in workspace:
  run_best_effort rm -rf -- "$WORKSPACE/.cache" "$WORKSPACE/tmp" "$WORKSPACE/.openclaw-cache"

  log "Workspace reset complete."
}

reset_state() {
  log "Resetting OpenClaw state dir (config/cache/indexes) ..."
  reset_plugin_build
  # Be careful: this may remove onboard configuration if stored under state dir.
  run_best_effort rm -rf -- "$STATE_DIR"
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
    log "Removing global openclaw CLI package (lighter full reset) ..."
    run_best_effort npm rm -g openclaw
    reset_workspace
    reset_state
    log "Done (full reset)."
    ;;
esac

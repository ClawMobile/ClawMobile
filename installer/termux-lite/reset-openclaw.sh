#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

LEVEL="soft"
DRY_RUN=0
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
WORKSPACE_OVERRIDE=""

REPO_ROOT="$(clawmobile_lite_repo_root)"
PLUGIN_DIR="$REPO_ROOT/openclaw-plugin-mobile-ui"
PLUGIN_ID="openclaw-plugin-mobile-ui"
LITE_SEEDED_SKILLS=(
  "clawmobile-capabilities"
  "clawmobile-policy"
  "clawmobile-trace-induction"
)

usage() {
  cat <<'USAGE'
Usage:
  reset-openclaw.sh [--level soft|workspace|plugin|state|full] [--dry-run]
                    [--state-dir PATH] [--workspace PATH]

Levels:
  soft       Stop OpenClaw gateway processes only.
  workspace  Remove only ClawMobile Lite seeded AGENTS/TOOLS blocks and skills.
  plugin     Remove the ClawMobile Lite plugin registration/install directory.
  state      Remove OpenClaw state dir after plugin cleanup.
  full       Also uninstall the global OpenClaw npm package.

Examples:
  ./installer/termux-lite/reset-openclaw.sh
  ./installer/termux-lite/reset-openclaw.sh --level workspace
  ./installer/termux-lite/reset-openclaw.sh --level plugin
USAGE
}

log() {
  echo "[lite-reset] $*"
}

dry_run_cmd() {
  printf '[dry-run]'
  printf ' %q' "$@"
  printf '\n'
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    dry_run_cmd "$@"
    return 0
  fi
  "$@"
}

run_best_effort() {
  if [ "$DRY_RUN" -eq 1 ]; then
    dry_run_cmd "$@"
    return 0
  fi
  "$@" || true
}

while [ $# -gt 0 ]; do
  case "$1" in
    --level)
      LEVEL="${2:-}"
      shift 2
      ;;
    --state-dir)
      STATE_DIR="${2:-}"
      shift 2
      ;;
    --workspace)
      WORKSPACE_OVERRIDE="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

case "$LEVEL" in
  soft|workspace|plugin|state|full) ;;
  *)
    echo "Invalid --level: $LEVEL" >&2
    usage
    exit 2
    ;;
esac

clawmobile_require_termux
clawmobile_lite_env

WORKSPACE="$WORKSPACE_OVERRIDE"
if [ -z "$WORKSPACE" ] && command -v openclaw >/dev/null 2>&1; then
  WORKSPACE="$(openclaw config get agents.defaults.workspace 2>/dev/null | tr -d '"' || true)"
fi
[ -n "$WORKSPACE" ] && [ "$WORKSPACE" != "null" ] || WORKSPACE="$STATE_DIR/workspace"

EXTENSION_DIR="$STATE_DIR/extensions/$PLUGIN_ID"
INSTALL_STAMP="$PLUGIN_DIR/.openclaw-plugin-installed-lite.stamp"

log "Level: $LEVEL"
log "State dir: $STATE_DIR"
log "Workspace: $WORKSPACE"

stop_gateway() {
  log "Stopping OpenClaw gateway processes (best effort)..."
  if command -v pkill >/dev/null 2>&1; then
    run_best_effort pkill -f "openclaw gateway"
    run_best_effort pkill -f "openclaw.*gateway"
  else
    log "pkill not found; skipping process stop."
  fi
}

clean_seeded_prompt_file() {
  local file="$1"
  local begin_marker="CLAWMOBILE_BEGIN"
  local end_marker="CLAWMOBILE_END"
  local tmp=""

  [ -f "$file" ] || return 0
  grep -q "$begin_marker" "$file" || return 0

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would remove ClawMobile block from $file"
    return 0
  fi

  tmp="${file}.tmp.lite-reset"
  awk -v begin_marker="$begin_marker" -v end_marker="$end_marker" '
index($0, begin_marker) {inblock=1; next}
index($0, end_marker) {inblock=0; next}
!inblock {print}
' "$file" > "$tmp"

  if [ ! -s "$tmp" ] || ! grep -q '[^[:space:]]' "$tmp"; then
    rm -f "$file" "$tmp"
  else
    mv "$tmp" "$file"
  fi
}

reset_workspace() {
  log "Resetting Lite workspace seed..."
  clean_seeded_prompt_file "$WORKSPACE/AGENTS.md"
  clean_seeded_prompt_file "$WORKSPACE/TOOLS.md"
  run_best_effort rm -rf -- "$WORKSPACE/AGENTS.mobile.md" "$WORKSPACE/TOOLS.mobile.md"
  local skill=""
  for skill in "${LITE_SEEDED_SKILLS[@]}"; do
    run_best_effort rm -rf -- "$WORKSPACE/skills/$skill"
  done
}

reset_plugin() {
  log "Resetting Lite plugin install state..."

  if [ "$DRY_RUN" -eq 1 ]; then
    dry_run_cmd openclaw plugins uninstall "$PLUGIN_ID"
    dry_run_cmd rm -rf -- "$EXTENSION_DIR" "$INSTALL_STAMP"
    return 0
  fi

  if command -v openclaw >/dev/null 2>&1; then
    clawmobile_remove_plugin_registration "$PLUGIN_ID" "$EXTENSION_DIR" || true
  else
    rm -rf -- "$EXTENSION_DIR"
  fi
  rm -f -- "$INSTALL_STAMP"
}

reset_plugin_build() {
  if [ -d "$PLUGIN_DIR/dist" ]; then
    log "Removing plugin build output: $PLUGIN_DIR/dist"
    run_best_effort rm -rf -- "$PLUGIN_DIR/dist"
  fi
}

reset_state() {
  reset_plugin
  reset_plugin_build
  log "Removing OpenClaw state dir..."
  run_best_effort rm -rf -- "$STATE_DIR"
}

stop_gateway

case "$LEVEL" in
  soft)
    ;;
  workspace)
    reset_workspace
    ;;
  plugin)
    reset_plugin
    ;;
  state)
    reset_state
    ;;
  full)
    if command -v npm >/dev/null 2>&1; then
      log "Uninstalling global OpenClaw npm package..."
      run_best_effort npm rm -g openclaw
    fi
    reset_state
    ;;
esac

log "Done."

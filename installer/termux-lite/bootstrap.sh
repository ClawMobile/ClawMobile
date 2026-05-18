#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO_URL="${CLAWMOBILE_REPO_URL:-https://github.com/ClawMobile/ClawMobile.git}"
REPO_BRANCH="${CLAWMOBILE_REPO_BRANCH:-main}"
TARGET_DIR="${CLAWMOBILE_HOME:-$HOME/ClawMobile}"
RUN_SETUP="${CLAWMOBILE_BOOTSTRAP_RUN_SETUP:-1}"
SOURCE_MODE="${CLAWMOBILE_BOOTSTRAP_SOURCE:-archive}"
ARCHIVE_MARKER=".clawmobile-bootstrap-source"

info() {
  echo "[lite-bootstrap] $*"
}

warn() {
  echo "[lite-bootstrap] WARNING: $*" >&2
}

die() {
  echo "[lite-bootstrap] ERROR: $*" >&2
  exit 1
}

repo_archive_url() {
  if [ -n "${CLAWMOBILE_REPO_ARCHIVE_URL:-}" ]; then
    printf '%s\n' "$CLAWMOBILE_REPO_ARCHIVE_URL"
    return 0
  fi

  local repo_path=""
  local normalized="${REPO_URL%.git}"

  case "$normalized" in
    https://github.com/*/*)
      repo_path="${normalized#https://github.com/}"
      ;;
    git@github.com:*/*)
      repo_path="${normalized#git@github.com:}"
      ;;
    ssh://git@github.com/*/*)
      repo_path="${normalized#ssh://git@github.com/}"
      ;;
    *)
      return 1
      ;;
  esac

  repo_path="${repo_path%/}"
  [ -n "$repo_path" ] || return 1
  printf 'https://codeload.github.com/%s/tar.gz/refs/heads/%s\n' "$repo_path" "$REPO_BRANCH"
}

download_repo_archive() {
  local archive_url=""
  local tmp_root="${TMPDIR:-${PREFIX:-/tmp}/tmp}"
  local tmp_dir=""
  local archive=""
  local extract_dir=""
  local top_dir=""

  command -v curl >/dev/null 2>&1 || return 1
  command -v tar >/dev/null 2>&1 || return 1

  archive_url="$(repo_archive_url)" || return 1
  mkdir -p "$tmp_root" 2>/dev/null || true
  tmp_dir="$(mktemp -d "$tmp_root/clawmobile-bootstrap.XXXXXX")"
  archive="$tmp_dir/repo.tar.gz"
  extract_dir="$tmp_dir/extract"
  mkdir -p "$extract_dir"

  info "Downloading repository archive: $archive_url"
  if ! curl -fL "$archive_url" -o "$archive"; then
    rm -rf "$tmp_dir"
    return 1
  fi

  if ! tar -xzf "$archive" -C "$extract_dir"; then
    rm -rf "$tmp_dir"
    return 1
  fi

  top_dir="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "$top_dir" ]; then
    rm -rf "$tmp_dir"
    return 1
  fi

  mkdir -p "$(dirname "$TARGET_DIR")"
  rm -rf "$TARGET_DIR"
  mv "$top_dir" "$TARGET_DIR"
  write_source_marker "archive" "$archive_url"
  rm -rf "$tmp_dir"
}

write_source_marker() {
  local source_type="$1"
  local archive_url="${2:-}"

  [ -d "$TARGET_DIR" ] || return 1
  cat > "$TARGET_DIR/$ARCHIVE_MARKER" <<EOF
repo_url=$REPO_URL
repo_branch=$REPO_BRANCH
source=$source_type
archive_url=$archive_url
EOF
}

clone_repo_with_git() {
  command -v git >/dev/null 2>&1 || return 1
  git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$TARGET_DIR"
  write_source_marker "git"
}

update_git_checkout() {
  command -v git >/dev/null 2>&1 || return 1
  git -C "$TARGET_DIR" fetch origin "$REPO_BRANCH"
  git -C "$TARGET_DIR" checkout "$REPO_BRANCH"
  git -C "$TARGET_DIR" pull --ff-only origin "$REPO_BRANCH"
}

prepare_repo() {
  if [ -d "$TARGET_DIR/.git" ]; then
    info "Updating existing git checkout: $TARGET_DIR"
    if ! update_git_checkout; then
      die "failed to update existing git checkout. Fix git/pkg first, or remove $TARGET_DIR and retry archive bootstrap."
    fi
    return 0
  fi

  if [ -e "$TARGET_DIR" ] && [ ! -f "$TARGET_DIR/$ARCHIVE_MARKER" ]; then
    die "target exists but is not a ClawMobile bootstrap checkout: $TARGET_DIR"
  fi

  if [ -f "$TARGET_DIR/$ARCHIVE_MARKER" ]; then
    info "Replacing existing bootstrap checkout: $TARGET_DIR"
  fi

  case "$SOURCE_MODE" in
    archive)
      rm -rf "$TARGET_DIR"
      download_repo_archive || die "archive download failed. This mode does not fall back to git; use CLAWMOBILE_BOOTSTRAP_SOURCE=auto if you want git fallback."
      ;;
    git)
      rm -rf "$TARGET_DIR"
      clone_repo_with_git || die "git clone failed. Try CLAWMOBILE_BOOTSTRAP_SOURCE=archive or repair Termux git/pkg."
      ;;
    auto)
      if download_repo_archive; then
        return 0
      fi
      warn "archive download failed; trying git clone."
      rm -rf "$TARGET_DIR"
      clone_repo_with_git || die "archive download failed and git clone was unavailable or failed."
      ;;
    *)
      die "unknown CLAWMOBILE_BOOTSTRAP_SOURCE=$SOURCE_MODE. Use archive, git, or auto."
      ;;
  esac
}

if [ -z "${PREFIX:-}" ] || [[ "${PREFIX:-}" != *"/com.termux/"* ]]; then
  die "this bootstrap must run inside Termux."
fi

info "Preparing ClawMobile checkout without changing Termux packages..."
prepare_repo

chmod +x "$TARGET_DIR/installer/termux-lite/clawmobile"
mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/clawmobile" <<WRAP
#!$PREFIX/bin/bash
exec "$TARGET_DIR/installer/termux-lite/clawmobile" "\$@"
WRAP
chmod +x "$PREFIX/bin/clawmobile"
info "Installed command wrapper: $PREFIX/bin/clawmobile"

if [ "$RUN_SETUP" = "1" ]; then
  info "Running ClawMobile setup..."
  if [ -r /dev/tty ]; then
    exec "$TARGET_DIR/installer/termux-lite/clawmobile" setup "$@" </dev/tty
  fi
  exec "$TARGET_DIR/installer/termux-lite/clawmobile" setup "$@"
fi

cat <<EOF

[lite-bootstrap] Bootstrap complete.

Next steps:
  clawmobile setup
  clawmobile run

Repo:
  $TARGET_DIR
EOF

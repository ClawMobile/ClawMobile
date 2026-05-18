#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO_URL="${CLAWMOBILE_REPO_URL:-https://github.com/ClawMobile/ClawMobile.git}"
REPO_BRANCH="${CLAWMOBILE_REPO_BRANCH:-main}"
TARGET_DIR="${CLAWMOBILE_HOME:-$HOME/ClawMobile}"
RUN_SETUP="${CLAWMOBILE_BOOTSTRAP_RUN_SETUP:-1}"

info() {
  echo "[lite-bootstrap] $*"
}

die() {
  echo "[lite-bootstrap] ERROR: $*" >&2
  exit 1
}

termux_apt_mirrors() {
  local mirrors=""

  if [ -n "${CLAWMOBILE_TERMUX_APT_MIRRORS:-}" ]; then
    mirrors="$CLAWMOBILE_TERMUX_APT_MIRRORS"
  elif [ -n "${CLAWMOBILE_TERMUX_APT_MIRROR:-}" ]; then
    mirrors="$CLAWMOBILE_TERMUX_APT_MIRROR"
  else
    mirrors="https://packages.termux.dev/apt/termux-main https://packages-cf.termux.dev/apt/termux-main https://mirror.sjtu.edu.cn/termux/termux-main https://mirrors.bfsu.edu.cn/termux/apt/termux-main https://mirrors.cernet.edu.cn/termux/apt/termux-main https://mirror.iscas.ac.cn/termux/apt/termux-main https://mirror.nyist.edu.cn/termux/apt/termux-main https://mirrors.aliyun.com/termux/termux-main"
  fi

  printf '%s\n' $mirrors
}

termux_set_apt_mirror() {
  local mirror="$1"
  local sources_dir="${PREFIX:-}/etc/apt"
  local main_list="$sources_dir/sources.list"
  local backup=""

  [ -n "${PREFIX:-}" ] || return 1
  [ -d "$sources_dir" ] || return 1

  backup="$main_list.clawmobile.bak"
  if [ -f "$main_list" ] && [ ! -f "$backup" ]; then
    cp "$main_list" "$backup"
    echo "[lite-bootstrap] Backed up Termux apt source: $backup" >&2
  fi

  printf 'deb %s stable main\n' "$mirror" > "$main_list"
  rm -rf "${PREFIX}/var/lib/apt/lists/"* 2>/dev/null || true
}

termux_restore_apt_backup() {
  local main_list="${PREFIX:-}/etc/apt/sources.list"
  local backup="$main_list.clawmobile.bak"

  if [ -f "$backup" ]; then
    cp "$backup" "$main_list"
    rm -rf "${PREFIX}/var/lib/apt/lists/"* 2>/dev/null || true
    echo "[lite-bootstrap] Restored original Termux apt source from: $backup" >&2
  fi
}

termux_apt_retry_with_fallback() {
  local mirror=""
  local update_log=""
  local command_log=""
  local status=1
  local tmp_dir="${TMPDIR:-${PREFIX:-/tmp}/tmp}"

  [ "${CLAWMOBILE_TERMUX_APT_FALLBACK:-1}" = "1" ] || return 1
  [ -n "${PREFIX:-}" ] || return 1
  [ -d "${PREFIX}/etc/apt" ] || return 1

  mkdir -p "$tmp_dir" 2>/dev/null || true

  for mirror in $(termux_apt_mirrors); do
    echo "[lite-bootstrap] Trying Termux package fallback mirror: $mirror" >&2
    termux_set_apt_mirror "$mirror" || continue

    update_log="$(mktemp "$tmp_dir/clawmobile-apt-update.XXXXXX")"
    if ! termux_apt_get update -y > >(tee "$update_log") 2> >(tee -a "$update_log" >&2); then
      rm -f "$update_log"
      continue
    fi
    if termux_apt_error_needs_mirror_fallback "$update_log"; then
      rm -f "$update_log"
      continue
    fi
    rm -f "$update_log"

    if [ "${1:-}" = "update" ]; then
      echo "[lite-bootstrap] Termux package fallback mirror is usable: $mirror" >&2
      return 0
    fi

    echo "[lite-bootstrap] Retrying Termux package command with mirror: $mirror" >&2
    command_log="$(mktemp "$tmp_dir/clawmobile-apt-command.XXXXXX")"
    if termux_apt_get "$@" > >(tee "$command_log") 2> >(tee -a "$command_log" >&2); then
      if ! termux_apt_error_needs_mirror_fallback "$command_log"; then
        rm -f "$command_log"
        echo "[lite-bootstrap] Termux package fallback mirror is usable: $mirror" >&2
        return 0
      fi
      status=1
    else
      status=$?
    fi

    if ! termux_apt_error_needs_mirror_fallback "$command_log"; then
      rm -f "$command_log"
      return "$status"
    fi
    rm -f "$command_log"
  done

  echo "[lite-bootstrap] WARNING: no Termux package fallback mirror was usable." >&2
  termux_restore_apt_backup
  return 1
}

termux_apt_get() {
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive \
      APT_LISTCHANGES_FRONTEND=none \
      UCF_FORCE_CONFFOLD=1 \
      apt-get \
      -o Dpkg::Options::="--force-confdef" \
      -o Dpkg::Options::="--force-confold" \
      "$@"
    return $?
  fi

  DEBIAN_FRONTEND=noninteractive \
    APT_LISTCHANGES_FRONTEND=none \
    UCF_FORCE_CONFFOLD=1 \
    pkg "$@"
}

termux_apt_error_needs_mirror_fallback() {
  local log_file="$1"

  [ -f "$log_file" ] || return 1
  grep -Eqi \
    'File has unexpected size|Hash Sum mismatch|Mirror sync in progress|Failed to fetch|Could not connect|Connection refused|Could not resolve|Temporary failure resolving|Unable to locate package|Package .* has no installation candidate|does not have a Release file|repository .* is not signed' \
    "$log_file"
}

termux_pkg() {
  local status=0
  local log_file=""
  local tmp_dir="${TMPDIR:-${PREFIX:-/tmp}/tmp}"

  mkdir -p "$tmp_dir" 2>/dev/null || true
  log_file="$(mktemp "$tmp_dir/clawmobile-apt.XXXXXX")"

  if termux_apt_get "$@" > >(tee "$log_file") 2> >(tee -a "$log_file" >&2); then
    if termux_apt_error_needs_mirror_fallback "$log_file"; then
      rm -f "$log_file"
      termux_apt_retry_with_fallback "$@"
      return $?
    fi
    rm -f "$log_file"
    return 0
  fi
  status=$?

  if termux_apt_error_needs_mirror_fallback "$log_file"; then
    rm -f "$log_file"
    termux_apt_retry_with_fallback "$@"
    return $?
  fi

  rm -f "$log_file"
  return "$status"
}

if [ -z "${PREFIX:-}" ] || [[ "${PREFIX:-}" != *"/com.termux/"* ]]; then
  die "this bootstrap must run inside Termux."
fi

info "Installing minimal Termux prerequisites..."
termux_pkg update -y
termux_pkg install -y git curl

if [ -d "$TARGET_DIR/.git" ]; then
  info "Updating existing checkout: $TARGET_DIR"
  git -C "$TARGET_DIR" fetch origin "$REPO_BRANCH"
  git -C "$TARGET_DIR" checkout "$REPO_BRANCH"
  git -C "$TARGET_DIR" pull --ff-only origin "$REPO_BRANCH"
elif [ -e "$TARGET_DIR" ]; then
  die "target exists but is not a git checkout: $TARGET_DIR"
else
  info "Cloning $REPO_URL#$REPO_BRANCH -> $TARGET_DIR"
  git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$TARGET_DIR"
fi

chmod +x "$TARGET_DIR/installer/termux-lite/clawmobile"
mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/clawmobile" <<WRAP
#!$PREFIX/bin/bash
exec "$TARGET_DIR/installer/termux-lite/clawmobile" "\$@"
WRAP
chmod +x "$PREFIX/bin/clawmobile"
info "Installed command wrapper: $PREFIX/bin/clawmobile"

if [ "$RUN_SETUP" = "1" ]; then
  info "Running ClawMobile Lite setup..."
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

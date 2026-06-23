#!/data/data/com.termux/files/usr/bin/bash

clawmobile_lite_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${script_dir}/../.." && pwd
}

clawmobile_lite_env() {
  local openclaw_android_home="${CLAWMOBILE_OPENCLAW_ANDROID_HOME:-$HOME/.openclaw-android}"
  local openclaw_android_bin="$openclaw_android_home/bin"
  local openclaw_android_node="$openclaw_android_home/node/bin"

  export CLAW_MOBILE_TERMUX_BIN="${CLAW_MOBILE_TERMUX_BIN:-/data/data/com.termux/files/usr/bin}"
  export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
  export OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_STATE_DIR/workspace}"
  export CLAWDHUB_WORKDIR="${CLAWDHUB_WORKDIR:-$OPENCLAW_WORKSPACE}"
  export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
  export TMP="$TMPDIR"
  export TEMP="$TMPDIR"
  export OA_GLIBC="${OA_GLIBC:-1}"
  export CONTAINER="${CONTAINER:-1}"

  if [ -d "$openclaw_android_bin" ]; then
    case ":$PATH:" in
      *":$openclaw_android_bin:"*) ;;
      *) export PATH="$openclaw_android_bin:$PATH" ;;
    esac
  fi

  if [ -d "$openclaw_android_node" ]; then
    case ":$PATH:" in
      *":$openclaw_android_node:"*) ;;
      *) export PATH="$openclaw_android_node:$PATH" ;;
    esac
  fi

  if [ -n "${PREFIX:-}" ]; then
    export CPATH="${CPATH:-$PREFIX/include/glib-2.0:$PREFIX/lib/glib-2.0/include}"
  fi

  if [ -z "${NPM_CONFIG_REGISTRY:-}" ] && [ -s "$openclaw_android_home/.npm-registry" ]; then
    NPM_CONFIG_REGISTRY="$(cat "$openclaw_android_home/.npm-registry")"
    export NPM_CONFIG_REGISTRY
  fi

  clawmobile_sync_openclaw_compat
  clawmobile_load_openclaw_env
}

clawmobile_sync_openclaw_compat() {
  local script_dir
  local openclaw_android_home="${CLAWMOBILE_OPENCLAW_ANDROID_HOME:-$HOME/.openclaw-android}"
  local patch_dir="$openclaw_android_home/patches"
  local compat_file=""
  local glibc_etc="${PREFIX:-/data/data/com.termux/files/usr}/glibc/etc"
  local hosts_file="$glibc_etc/hosts"

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  compat_file="$script_dir/openclaw-compat/glibc-compat.js"
  if [ -f "$compat_file" ]; then
    mkdir -p "$patch_dir"
    cp "$compat_file" "$patch_dir/glibc-compat.js"
  fi

  [ -d "$glibc_etc" ] || return 0
  if [ ! -f "$hosts_file" ]; then
    cat > "$hosts_file" <<'HOSTS'
127.0.0.1 localhost localhost.localdomain loopback
::1 localhost ip6-localhost ip6-loopback
HOSTS
  elif ! grep -Eq '(^|[[:space:]])loopback([[:space:]]|$)' "$hosts_file"; then
    printf '127.0.0.1 loopback\n' >> "$hosts_file"
  fi
}

clawmobile_load_openclaw_env() {
  local env_file="${OPENCLAW_ENV_FILE:-${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/.env}"
  local line=""
  local name=""
  local value=""
  local current=""

  [ -f "$env_file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
      *=*) ;;
      *) continue ;;
    esac

    name="${line%%=*}"
    value="${line#*=}"
    if ! printf '%s\n' "$name" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$'; then
      continue
    fi

    current="${!name-}"
    if [ -z "$current" ]; then
      export "$name=$value"
    fi
  done < "$env_file"
}

clawmobile_require_termux() {
  if [ -z "${PREFIX:-}" ] || [[ "${PREFIX:-}" != *"/com.termux/"* ]]; then
    echo "[lite] ERROR: this script must run inside Termux." >&2
    exit 1
  fi
}

clawmobile_android_cmd() {
  if command -v cmd >/dev/null 2>&1; then
    command cmd "$@"
  elif [ -x /system/bin/cmd ]; then
    /system/bin/cmd "$@"
  else
    return 127
  fi
}

clawmobile_android_dumpsys() {
  if command -v dumpsys >/dev/null 2>&1; then
    command dumpsys "$@"
  elif [ -x /system/bin/dumpsys ]; then
    /system/bin/dumpsys "$@"
  else
    return 127
  fi
}

clawmobile_termux_installer_package() {
  local line=""
  local installer=""

  line="$(clawmobile_android_cmd package list packages -i com.termux 2>/dev/null | head -n 1 || true)"
  case "$line" in
    *installer=*)
      installer="${line##*installer=}"
      installer="${installer%%[[:space:]]*}"
      ;;
  esac

  if [ -z "$installer" ]; then
    installer="$(clawmobile_android_dumpsys package com.termux 2>/dev/null | sed -n 's/.*installerPackageName=//p' | head -n 1 || true)"
    installer="${installer%%[[:space:]]*}"
  fi

  printf '%s\n' "${installer:-unknown}"
}

clawmobile_termux_version() {
  local version=""

  if command -v termux-info >/dev/null 2>&1; then
    version="$(termux-info 2>/dev/null | sed -n 's/^TERMUX_VERSION=//p' | head -n 1 || true)"
  fi

  if [ -z "$version" ]; then
    version="$(clawmobile_android_dumpsys package com.termux 2>/dev/null | sed -n 's/.*versionName=//p' | head -n 1 || true)"
    version="${version%%[[:space:]]*}"
  fi

  printf '%s\n' "${version:-unknown}"
}

clawmobile_termux_apk_release() {
  local release=""

  if command -v termux-info >/dev/null 2>&1; then
    release="$(termux-info 2>/dev/null | sed -n 's/^TERMUX_APP__APK_RELEASE=//p' | head -n 1 || true)"
  fi

  printf '%s\n' "${release:-unknown}"
}

clawmobile_termux_source_kind() {
  local installer="${1:-}"
  local apk_release="${2:-}"

  case "$apk_release" in
    F_DROID|FDROID|F-DROID|fdroid)
      printf '%s\n' "fdroid"
      return 0
      ;;
    GOOGLE_PLAY|GOOGLEPLAY|PLAY_STORE|PLAYSTORE|google_play)
      printf '%s\n' "google_play"
      return 0
      ;;
    GITHUB|GITHUB_RELEASE|github)
      printf '%s\n' "github_or_sideload"
      return 0
      ;;
  esac

  case "$installer" in
    com.android.vending)
      printf '%s\n' "google_play"
      ;;
    org.fdroid.fdroid|org.fdroid.basic)
      printf '%s\n' "fdroid"
      ;;
    ""|null|"<null>"|com.android.packageinstaller|com.google.android.packageinstaller|packageinstaller)
      printf '%s\n' "github_or_sideload"
      ;;
    *)
      printf '%s\n' "unknown"
      ;;
  esac
}

clawmobile_termux_source_label() {
  local kind="${1:-unknown}"

  case "$kind" in
    google_play) printf '%s\n' "Google Play" ;;
    fdroid) printf '%s\n' "F-Droid" ;;
    github_or_sideload) printf '%s\n' "GitHub/sideload" ;;
    *) printf '%s\n' "unknown" ;;
  esac
}

clawmobile_termux_source_preflight() {
  local installer=""
  local version=""
  local apk_release=""
  local kind=""
  local label=""

  [ "${CLAWMOBILE_TERMUX_SOURCE_CHECK:-1}" = "1" ] || return 0
  [ "${CLAWMOBILE_TERMUX_SOURCE_CHECK_DONE:-0}" = "1" ] && return 0

  installer="$(clawmobile_termux_installer_package)"
  version="$(clawmobile_termux_version)"
  apk_release="$(clawmobile_termux_apk_release)"
  kind="$(clawmobile_termux_source_kind "$installer" "$apk_release")"
  label="$(clawmobile_termux_source_label "$kind")"
  export CLAWMOBILE_TERMUX_SOURCE_CHECK_DONE=1

  case "$kind" in
    google_play)
      if [ "${CLAWMOBILE_ALLOW_PLAY_TERMUX:-0}" = "1" ]; then
        cat >&2 <<MSG
[lite] WARNING: Google Play Termux detected (version=$version, apk_release=$apk_release, installer=$installer).

ClawMobile's supported install baseline is Termux from F-Droid or the official
Termux GitHub releases. Continuing best-effort because
CLAWMOBILE_ALLOW_PLAY_TERMUX=1.
MSG
        return 0
      fi

      cat >&2 <<MSG
[lite] ERROR: Google Play Termux detected (version=$version, apk_release=$apk_release, installer=$installer).

ClawMobile's supported install baseline is Termux from F-Droid or the official
Termux GitHub releases. Google Play Termux is a separate/best-effort path and
may differ in package availability, Termux:API behavior, and Android
permissions.

Install Termux from F-Droid/GitHub and rerun setup. To continue best-effort on
Google Play Termux anyway, rerun with:
  CLAWMOBILE_ALLOW_PLAY_TERMUX=1 clawmobile setup --quick

If the clawmobile command has not been installed yet and you are running from a
repository checkout, use:
  CLAWMOBILE_ALLOW_PLAY_TERMUX=1 ./installer/termux-lite/clawmobile setup --quick
MSG
      exit 1
      ;;
    fdroid|github_or_sideload)
      echo "[lite] Termux source check: $label (version=$version, apk_release=$apk_release, installer=$installer)."
      ;;
    *)
      echo "[lite] WARNING: Termux source is unknown (version=$version, apk_release=$apk_release, installer=$installer); continuing best-effort." >&2
      ;;
  esac
}

clawmobile_require_openclaw() {
  if command -v openclaw >/dev/null 2>&1; then
    return 0
  fi

  cat >&2 <<'MSG'
[lite] ERROR: openclaw was not found in PATH.

Install OpenClaw for Android/Termux first, then re-run this script.
Reference project:
  https://github.com/AidanPark/openclaw-android

From this repo, you can also run:
  ./installer/termux-lite/install-openclaw.sh

Or let install.sh do that first:
  CLAWMOBILE_TERMUX_INSTALL_OPENCLAW=1 ./installer/termux-lite/install.sh
MSG
  exit 1
}

clawmobile_require_npm() {
  if command -v npm >/dev/null 2>&1; then
    return 0
  fi

  cat >&2 <<'MSG'
[lite] ERROR: npm was not found in PATH.

If OpenClaw was installed by the ClawMobile Termux runtime bootstrap, verify:
  ~/.openclaw-android/bin/npm

Or reinstall OpenClaw with:
  CLAWMOBILE_TERMUX_INSTALL_OPENCLAW=1 ./installer/termux-lite/install.sh
MSG
  exit 1
}

clawmobile_termux_apt_mirrors() {
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

clawmobile_termux_set_apt_mirror() {
  local mirror="$1"
  local sources_dir="${PREFIX:-}/etc/apt"
  local main_list="$sources_dir/sources.list"
  local backup=""

  [ -n "${PREFIX:-}" ] || return 1
  [ -d "$sources_dir" ] || return 1

  backup="$main_list.clawmobile.bak"
  if [ -f "$main_list" ] && [ ! -f "$backup" ]; then
    cp "$main_list" "$backup"
    echo "[lite] Backed up Termux apt source: $backup" >&2
  fi

  printf 'deb %s stable main\n' "$mirror" > "$main_list"
  rm -rf "${PREFIX}/var/lib/apt/lists/"* 2>/dev/null || true
}

clawmobile_termux_restore_apt_backup() {
  local main_list="${PREFIX:-}/etc/apt/sources.list"
  local backup="$main_list.clawmobile.bak"

  if [ -f "$backup" ]; then
    cp "$backup" "$main_list"
    rm -rf "${PREFIX}/var/lib/apt/lists/"* 2>/dev/null || true
    echo "[lite] Restored original Termux apt source from: $backup" >&2
  fi
}

clawmobile_termux_apt_retry_with_fallback() {
  local mirror=""
  local update_log=""
  local command_log=""
  local status=1
  local tmp_dir="${TMPDIR:-${PREFIX:-/tmp}/tmp}"

  [ "${CLAWMOBILE_TERMUX_APT_FALLBACK:-1}" = "1" ] || return 1
  [ -n "${PREFIX:-}" ] || return 1
  [ -d "${PREFIX}/etc/apt" ] || return 1

  mkdir -p "$tmp_dir" 2>/dev/null || true

  for mirror in $(clawmobile_termux_apt_mirrors); do
    echo "[lite] Trying Termux package fallback mirror: $mirror" >&2
    clawmobile_termux_set_apt_mirror "$mirror" || continue

    update_log="$(mktemp "$tmp_dir/clawmobile-apt-update.XXXXXX")"
    if ! clawmobile_apt_get update -y > >(tee "$update_log") 2> >(tee -a "$update_log" >&2); then
      rm -f "$update_log"
      continue
    fi
    if clawmobile_apt_error_needs_mirror_fallback "$update_log"; then
      rm -f "$update_log"
      continue
    fi
    rm -f "$update_log"

    if [ "${1:-}" = "update" ]; then
      echo "[lite] Termux package fallback mirror is usable: $mirror" >&2
      return 0
    fi

    echo "[lite] Retrying Termux package command with mirror: $mirror" >&2
    command_log="$(mktemp "$tmp_dir/clawmobile-apt-command.XXXXXX")"
    if clawmobile_apt_get "$@" > >(tee "$command_log") 2> >(tee -a "$command_log" >&2); then
      if ! clawmobile_apt_error_needs_mirror_fallback "$command_log"; then
        rm -f "$command_log"
        echo "[lite] Termux package fallback mirror is usable: $mirror" >&2
        return 0
      fi
      status=1
    else
      status=$?
    fi

    if ! clawmobile_apt_error_needs_mirror_fallback "$command_log"; then
      rm -f "$command_log"
      return "$status"
    fi
    rm -f "$command_log"
  done

  echo "[lite] WARNING: no Termux package fallback mirror was usable." >&2
  clawmobile_termux_restore_apt_backup
  return 1
}

clawmobile_apt_get() {
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

clawmobile_apt_error_needs_mirror_fallback() {
  local log_file="$1"

  [ -f "$log_file" ] || return 1
  grep -Eqi \
    'File has unexpected size|Hash Sum mismatch|Mirror sync in progress|Failed to fetch|Could not connect|Connection refused|Could not resolve|Temporary failure resolving|Unable to locate package|Package .* has no installation candidate|does not have a Release file|repository .* is not signed' \
    "$log_file"
}

clawmobile_pkg() {
  local status=0
  local log_file=""
  local tmp_dir="${TMPDIR:-${PREFIX:-/tmp}/tmp}"

  mkdir -p "$tmp_dir" 2>/dev/null || true
  log_file="$(mktemp "$tmp_dir/clawmobile-apt.XXXXXX")"

  if clawmobile_apt_get "$@" > >(tee "$log_file") 2> >(tee -a "$log_file" >&2); then
    if clawmobile_apt_error_needs_mirror_fallback "$log_file"; then
      rm -f "$log_file"
      clawmobile_termux_apt_retry_with_fallback "$@"
      return $?
    fi
    rm -f "$log_file"
    return 0
  fi
  status=$?

  if clawmobile_apt_error_needs_mirror_fallback "$log_file"; then
    rm -f "$log_file"
    clawmobile_termux_apt_retry_with_fallback "$@"
    return $?
  fi

  rm -f "$log_file"
  return "$status"
}

clawmobile_plugin_needs_lite_build() {
  local plugin_dir="$1"

  if [ "${CLAWMOBILE_TERMUX_FORCE_BUILD:-0}" = "1" ]; then
    echo "[lite] building plugin (CLAWMOBILE_TERMUX_FORCE_BUILD=1)..."
    return 0
  fi

  if [ ! -f "$plugin_dir/dist/index.js" ] || [ ! -f "$plugin_dir/dist/CLAWMOBILE_TERMUX_RUNTIME.txt" ]; then
    echo "[lite] building plugin (Termux runtime dist output missing)..."
    return 0
  fi

  if [ -e "$plugin_dir/dist/pyexec" ] || [ -e "$plugin_dir/dist/backends/droidrun.js" ]; then
    echo "[lite] building plugin (full-backend dist artifacts present)..."
    return 0
  fi

  if [ "$plugin_dir/package.json" -nt "$plugin_dir/dist/index.js" ] || \
     [ "$plugin_dir/tsconfig.json" -nt "$plugin_dir/dist/index.js" ]; then
    echo "[lite] building plugin (package or tsconfig changed)..."
    return 0
  fi

  if [ -n "$(find "$plugin_dir/src" "$plugin_dir/scripts" -type f -newer "$plugin_dir/dist/index.js" -print -quit 2>/dev/null || true)" ]; then
    echo "[lite] building plugin (source newer than dist)..."
    return 0
  fi

  return 1
}

clawmobile_build_plugin_lite() {
  local repo_root="$1"
  local plugin_dir="$repo_root/openclaw-plugin-mobile-ui"

  if ! clawmobile_plugin_needs_lite_build "$plugin_dir"; then
    echo "[lite] Plugin Termux runtime build is current; skipping build."
    return 0
  fi

  echo "[lite] Building plugin in capability-aware Termux runtime mode..."
  (
    cd "$plugin_dir"
    npm install --include=dev --no-audit --no-fund
    npm run build
  )
}

clawmobile_sync_marked_block() {
  local target="$1"
  local block="$2"
  local start="<!-- CLAWMOBILE_BEGIN -->"
  local end="<!-- CLAWMOBILE_END -->"
  local action="Injected"

  [ -f "$block" ] || return 0
  mkdir -p "$(dirname "$target")"
  touch "$target"

  if grep -qF "$start" "$target"; then
    sed -i "\|$start|,\|$end|d" "$target"
    action="Updated"
  fi

  printf "\n\n" >> "$target"
  cat "$block" >> "$target"
  printf "\n" >> "$target"
  echo "[lite] $action mobile block in $(basename "$target")"
}

clawmobile_prompt_file_needs_openclaw_default() {
  local file="$1"
  local start="<!-- CLAWMOBILE_BEGIN -->"
  local end="<!-- CLAWMOBILE_END -->"
  local tmp=""

  [ -f "$file" ] || return 0
  grep -q '[^[:space:]]' "$file" || return 0

  if grep -qF "$start" "$file"; then
    tmp="$(mktemp "${TMPDIR:-/tmp}/clawmobile-prompt-check.XXXXXX")" || return 1
    awk -v start="$start" -v end="$end" '
      index($0, start) { inblock=1; next }
      index($0, end) { inblock=0; next }
      !inblock { print }
    ' "$file" > "$tmp"
    if grep -q '[^[:space:]]' "$tmp"; then
      rm -f "$tmp"
      return 1
    fi
    rm -f "$tmp"
    return 0
  fi

  return 1
}

clawmobile_seed_openclaw_workspace_defaults() {
  local workspace="$1"
  local tmp_root=""
  local defaults_workspace=""
  local need_defaults=0
  local name=""

  for name in AGENTS.md TOOLS.md; do
    if clawmobile_prompt_file_needs_openclaw_default "$workspace/$name"; then
      need_defaults=1
      break
    fi
  done

  [ "$need_defaults" -eq 1 ] || return 0
  command -v openclaw >/dev/null 2>&1 || return 0

  tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/clawmobile-openclaw-defaults.XXXXXX")" || return 0
  defaults_workspace="$tmp_root/workspace"
  mkdir -p "$tmp_root/home"

  echo "[lite] Restoring OpenClaw starter workspace files before injecting the ClawMobile workspace seed..."
  if (
    HOME="$tmp_root/home"
    OPENCLAW_STATE_DIR="$tmp_root/home/.openclaw"
    OPENCLAW_WORKSPACE="$defaults_workspace"
    CLAWDHUB_WORKDIR="$defaults_workspace"
    openclaw onboard \
      --non-interactive \
      --accept-risk \
      --mode local \
      --auth-choice skip \
      --skip-daemon \
      --skip-skills \
      --skip-health \
      --skip-channels \
      --skip-search \
      --skip-ui \
      --workspace "$defaults_workspace" \
      </dev/null >/dev/null 2>&1
  ); then
    for name in AGENTS.md TOOLS.md; do
      if clawmobile_prompt_file_needs_openclaw_default "$workspace/$name" && [ -f "$defaults_workspace/$name" ]; then
        cp "$defaults_workspace/$name" "$workspace/$name"
        echo "[lite] Restored OpenClaw starter $name"
      fi
    done
  else
    echo "[lite] WARNING: failed to generate OpenClaw starter workspace files; continuing with the ClawMobile workspace seed only." >&2
  fi

  rm -rf "$tmp_root"
}

clawmobile_remove_plugin_registration() {
  local plugin_id="$1"
  local extension_dir="$2"

  # Remove stale OpenClaw plugin config/index state before touching files.
  # This keeps a missing extension directory from producing
  # "plugins.entries.<id>: plugin not found" warnings on the next CLI call.
  if openclaw plugins uninstall "$plugin_id" --keep-files </dev/null >/dev/null 2>&1; then
    echo "[lite] Removed existing plugin registration: $plugin_id"
  else
    openclaw plugins uninstall "$plugin_id" </dev/null >/dev/null 2>&1 || true
  fi

  openclaw config unset "plugins.entries[\"$plugin_id\"]" </dev/null >/dev/null 2>&1 || true
  openclaw config unset "plugins.installs[\"$plugin_id\"]" </dev/null >/dev/null 2>&1 || true
  openclaw plugins registry --refresh </dev/null >/dev/null 2>&1 || true

  if [ -d "$extension_dir" ]; then
    echo "[lite] Removing existing plugin directory: $extension_dir"
    rm -rf "$extension_dir"
  fi
}

clawmobile_plugin_installed() {
  local plugin_id="$1"
  local extension_dir="$2"
  local plugin_list=""

  if plugin_list="$(openclaw plugins list </dev/null 2>/dev/null)"; then
    printf '%s\n' "$plugin_list" | grep -q "$plugin_id"
    return
  fi

  [ -d "$extension_dir" ]
}

clawmobile_enable_plugin() {
  local plugin_id="$1"

  if ! command -v openclaw >/dev/null 2>&1; then
    return 0
  fi

  openclaw plugins enable "$plugin_id" </dev/null >/dev/null 2>&1 || true
  openclaw config set "plugins.entries[\"$plugin_id\"].enabled" true </dev/null >/dev/null 2>&1 || true
  openclaw plugins registry --refresh </dev/null >/dev/null 2>&1 || true
}

clawmobile_plugin_needs_install() {
  local plugin_dir="$1"
  local plugin_id="$2"
  local extension_dir="$3"
  local install_stamp="$4"

  if [ "${CLAWMOBILE_TERMUX_FORCE_PLUGIN_INSTALL:-0}" = "1" ]; then
    echo "[lite] plugin install required (CLAWMOBILE_TERMUX_FORCE_PLUGIN_INSTALL=1)"
    return 0
  fi

  if ! clawmobile_plugin_installed "$plugin_id" "$extension_dir"; then
    echo "[lite] plugin install required (plugin not currently installed)"
    return 0
  fi

  if [ ! -f "$install_stamp" ]; then
    echo "[lite] plugin install required (install stamp missing)"
    return 0
  fi

  if [ "$plugin_dir/openclaw.plugin.json" -nt "$install_stamp" ] || \
     [ "$plugin_dir/package.json" -nt "$install_stamp" ]; then
    echo "[lite] plugin install required (plugin metadata newer than install stamp)"
    return 0
  fi

  if [ -n "$(find "$plugin_dir/dist" -type f -newer "$install_stamp" -print -quit 2>/dev/null || true)" ]; then
    echo "[lite] plugin install required (dist newer than install stamp)"
    return 0
  fi

  return 1
}

clawmobile_install_plugin() {
  local plugin_dir="$1"
  local plugin_id="openclaw-plugin-mobile-ui"
  local extension_dir="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/extensions/$plugin_id"
  local install_stamp="$plugin_dir/.openclaw-plugin-installed-lite.stamp"
  local help_text=""

  echo "[lite] Checking OpenClaw plugin install state..."
  if ! clawmobile_plugin_needs_install "$plugin_dir" "$plugin_id" "$extension_dir" "$install_stamp"; then
    clawmobile_enable_plugin "$plugin_id"
    echo "[lite] Plugin already installed and no local updates detected; skipping reinstall."
    return 0
  fi

  clawmobile_remove_plugin_registration "$plugin_id" "$extension_dir"

  help_text="$(openclaw plugins install --help </dev/null 2>/dev/null || true)"

  echo "[lite] Installing OpenClaw plugin: $plugin_dir"
  if printf '%s\n' "$help_text" | grep -q -- "--dangerously-force-unsafe-install"; then
    if openclaw plugins install --dangerously-force-unsafe-install "$plugin_dir" </dev/null; then
      clawmobile_enable_plugin "$plugin_id"
      touch "$install_stamp"
      return 0
    fi
  fi

  if printf '%s\n' "$help_text" | grep -q -- "--force"; then
    if openclaw plugins install --force "$plugin_dir" </dev/null; then
      clawmobile_enable_plugin "$plugin_id"
      touch "$install_stamp"
      return 0
    fi
  fi

  if openclaw plugins install "$plugin_dir" </dev/null; then
    clawmobile_enable_plugin "$plugin_id"
    touch "$install_stamp"
    return 0
  fi

  if [ -d "$extension_dir" ]; then
    clawmobile_remove_plugin_registration "$plugin_id" "$extension_dir"
    openclaw plugins install "$plugin_dir" </dev/null
    clawmobile_enable_plugin "$plugin_id"
    touch "$install_stamp"
    return
  fi

  return 1
}

clawmobile_sync_workspace_seed() {
  local repo_root="$1"
  local seed_dir="$repo_root/installer/workspace-seed-lite"
  local workspace="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
  local skills_src="$seed_dir/skills"
  local skills_dst="$workspace/skills"

  mkdir -p "$workspace"
  if command -v openclaw >/dev/null 2>&1; then
    local configured
    configured="$(openclaw config get agents.defaults.workspace </dev/null 2>/dev/null | tr -d '"' || true)"
    if [ -n "$configured" ] && [ "$configured" != "null" ]; then
      workspace="$configured"
      export OPENCLAW_WORKSPACE="$workspace"
      mkdir -p "$workspace"
    fi
  fi

  export OPENCLAW_WORKSPACE="$workspace"
  export CLAWDHUB_WORKDIR="$workspace"

  clawmobile_seed_openclaw_workspace_defaults "$workspace"
  clawmobile_sync_marked_block "$workspace/AGENTS.md" "$seed_dir/AGENTS.mobile.md"
  clawmobile_sync_marked_block "$workspace/TOOLS.md" "$seed_dir/TOOLS.mobile.md"

  if [ -d "$skills_src" ]; then
    mkdir -p "$skills_dst"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a "$skills_src"/ "$skills_dst"/
    else
      cp -R "$skills_src"/. "$skills_dst"/
    fi
    echo "[lite] Synced ClawMobile runtime skills -> $skills_dst"
  else
    echo "[lite] WARNING: ClawMobile runtime seed skills not found at $skills_src" >&2
  fi

  echo "[lite] Synced ClawMobile Termux runtime workspace seed -> $workspace"
}

clawmobile_select_adb_device() {
  if ! command -v adb >/dev/null 2>&1; then
    echo "[lite] adb not found; continuing in Termux-only capability stage." >&2
    return 0
  fi

  adb start-server >/dev/null 2>&1 || true
  mapfile -t devices < <(adb devices | awk 'NR>1 && $2=="device" {print $1}')

  if [ "${#devices[@]}" -eq 0 ]; then
    echo "[lite] no adb device in 'device' state; continuing in Termux-only capability stage."
    adb devices || true
    return 0
  fi

  if [ -z "${ANDROID_SERIAL:-}" ]; then
    local pick=""
    local serial
    for serial in "${devices[@]}"; do
      if [ "$serial" = "127.0.0.1:5555" ]; then
        pick="$serial"
        break
      fi
    done
    [ -n "$pick" ] || pick="${devices[0]}"
    export ANDROID_SERIAL="$pick"
  fi

  export DROIDRUN_SERIAL="$ANDROID_SERIAL"
  echo "[lite] adb selected serial: $ANDROID_SERIAL"
}

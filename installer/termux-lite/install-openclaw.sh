#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

clawmobile_require_termux
clawmobile_lite_env

PROJECT_DIR="${CLAWMOBILE_OPENCLAW_ANDROID_HOME:-$HOME/.openclaw-android}"
BIN_DIR="$PROJECT_DIR/bin"
NODE_DIR="$PROJECT_DIR/node"
PATCH_DIR="$PROJECT_DIR/patches"
COMPAT_DIR="$SCRIPT_DIR/openclaw-compat"
GLIBC_LDSO="$PREFIX/glibc/lib/ld-linux-aarch64.so.1"
GLIBC_LIB_DIR="$PREFIX/glibc/lib"
NODE_VERSION="${CLAWMOBILE_OPENCLAW_NODE_VERSION:-22.22.0}"
NODE_TARBALL="node-v${NODE_VERSION}-linux-arm64.tar.xz"
NODE_URL="${CLAWMOBILE_OPENCLAW_NODE_URL:-https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}}"
OPENCLAW_NPM_SPEC="${CLAWMOBILE_OPENCLAW_NPM_SPEC:-openclaw@2026.5.7}"
INSTALL_CLAWDHUB="${CLAWMOBILE_INSTALL_CLAWDHUB:-1}"
if [ -n "${CLAWMOBILE_OPENCLAW_RUN_UPDATE+x}" ]; then
  RUN_OPENCLAW_UPDATE="$CLAWMOBILE_OPENCLAW_RUN_UPDATE"
elif [ "$OPENCLAW_NPM_SPEC" = "openclaw@latest" ] || [ "$OPENCLAW_NPM_SPEC" = "latest" ]; then
  RUN_OPENCLAW_UPDATE="1"
else
  RUN_OPENCLAW_UPDATE="0"
fi
NPM_REGISTRY_ORIGIN="${CLAWMOBILE_NPM_REGISTRY_ORIGIN:-https://registry.npmjs.org/}"
NPM_REGISTRY_MIRROR="${CLAWMOBILE_NPM_REGISTRY_MIRROR:-https://registry.npmmirror.com/}"

info() {
  echo "[lite] $*"
}

warn() {
  echo "[lite] WARNING: $*" >&2
}

die() {
  echo "[lite] ERROR: $*" >&2
  exit 1
}

require_aarch64() {
  local arch
  arch="$(uname -m)"
  if [ "$arch" != "aarch64" ]; then
    die "the self-contained OpenClaw bootstrap currently requires aarch64 Termux (got: $arch)."
  fi
}

ensure_dirs() {
  mkdir -p "$PROJECT_DIR" "$BIN_DIR" "$PATCH_DIR" "$PREFIX/tmp"
}

install_termux_packages() {
  info "Installing Termux packages needed for glibc Node/OpenClaw..."
  clawmobile_pkg update -y
  if [ "${CLAWMOBILE_TERMUX_UPGRADE:-0}" = "1" ]; then
    clawmobile_pkg upgrade -y
  fi
  clawmobile_pkg install -y git curl tar xz-utils coreutils findutils gawk python make cmake clang binutils pacman

  command -v pacman >/dev/null 2>&1 || die "pacman was not installed; Termux package index may be stale or mirror fallback failed."

  if [ ! -e "$PREFIX/bin/ar" ] && [ -x "$PREFIX/bin/llvm-ar" ]; then
    ln -s "$PREFIX/bin/llvm-ar" "$PREFIX/bin/ar"
  fi
}

ensure_glibc_hosts() {
  local glibc_etc="$PREFIX/glibc/etc"
  if [ -d "$glibc_etc" ] && [ ! -f "$glibc_etc/hosts" ]; then
    cat > "$glibc_etc/hosts" <<'HOSTS'
127.0.0.1 localhost localhost.localdomain
::1 localhost ip6-localhost ip6-loopback
HOSTS
  fi
}

install_glibc_runner() {
  local pacman_conf="$PREFIX/etc/pacman.conf"
  local siglevel_patched=false

  if [ -f "$PROJECT_DIR/.glibc-arch" ] && [ -x "$GLIBC_LDSO" ]; then
    info "glibc-runner already installed."
    ensure_glibc_hosts
    return
  fi

  info "Installing glibc-runner through Termux pacman..."
  if [ -f "$pacman_conf" ] && ! grep -q "^SigLevel = Never" "$pacman_conf"; then
    cp "$pacman_conf" "${pacman_conf}.bak"
    sed -i 's/^SigLevel[[:space:]]*=.*/SigLevel = Never/' "$pacman_conf"
    siglevel_patched=true
  fi

  pacman-key --init 2>/dev/null || true
  pacman-key --populate 2>/dev/null || true

  if ! pacman -Sy glibc-runner --noconfirm --assume-installed bash,patchelf,resolv-conf; then
    if [ "$siglevel_patched" = true ] && [ -f "${pacman_conf}.bak" ]; then
      mv "${pacman_conf}.bak" "$pacman_conf"
    fi
    die "failed to install glibc-runner."
  fi

  if [ "$siglevel_patched" = true ] && [ -f "${pacman_conf}.bak" ]; then
    mv "${pacman_conf}.bak" "$pacman_conf"
  fi

  [ -x "$GLIBC_LDSO" ] || die "glibc dynamic linker not found at $GLIBC_LDSO."
  ensure_glibc_hosts
  touch "$PROJECT_DIR/.glibc-arch"
}

create_node_wrappers() {
  mkdir -p "$BIN_DIR"

  if [ -f "$NODE_DIR/bin/node" ] && [ ! -f "$NODE_DIR/bin/node.real" ]; then
    mv "$NODE_DIR/bin/node" "$NODE_DIR/bin/node.real"
  fi

  [ -f "$NODE_DIR/bin/node.real" ] || die "Node.js binary missing at $NODE_DIR/bin/node.real."

  cat > "$BIN_DIR/node" <<NODEWRAP
#!$PREFIX/bin/bash
[ -n "\$LD_PRELOAD" ] && export _OA_ORIG_LD_PRELOAD="\$LD_PRELOAD"
unset LD_PRELOAD
export _OA_WRAPPER_PATH="$BIN_DIR/node"
_OA_COMPAT="$PATCH_DIR/glibc-compat.js"
if [ -f "\$_OA_COMPAT" ]; then
  case "\${NODE_OPTIONS:-}" in
    *"\$_OA_COMPAT"*) ;;
    *) export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }-r \$_OA_COMPAT" ;;
  esac
fi
_LEADING_OPTS=""
_COUNT=0
for _arg in "\$@"; do
  case "\$_arg" in --*) _COUNT=\$((_COUNT + 1)) ;; *) break ;; esac
done
if [ \$_COUNT -gt 0 ] && [ \$_COUNT -lt \$# ]; then
  while [ \$# -gt 0 ]; do
    case "\$1" in
      --*) _LEADING_OPTS="\${_LEADING_OPTS:+\$_LEADING_OPTS }\$1"; shift ;;
      *) break ;;
    esac
  done
  export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }\$_LEADING_OPTS"
fi
exec "$GLIBC_LDSO" --library-path "$GLIBC_LIB_DIR" "$NODE_DIR/bin/node.real" "\$@"
NODEWRAP
  chmod +x "$BIN_DIR/node"

  if [ -f "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" ]; then
    cat > "$BIN_DIR/npm" <<'NPMWRAP'
#!__PREFIX__/bin/bash
"__BIN_DIR__/node" "__NODE_DIR__/lib/node_modules/npm/bin/npm-cli.js" "$@"
_npm_exit=$?
case "$*" in *-g*openclaw*|*--global*openclaw*|*openclaw*-g*|*openclaw*--global*)
  _oc_bin="__PREFIX__/bin/openclaw"
  _oc_mjs="__PREFIX__/lib/node_modules/openclaw/openclaw.mjs"
  if [ -f "$_oc_mjs" ]; then
    [ -L "$_oc_bin" ] && rm -f "$_oc_bin"
    printf '#!__PREFIX__/bin/bash\nexec "__BIN_DIR__/node" "%s" "$@"\n' "$_oc_mjs" > "$_oc_bin"
    chmod +x "$_oc_bin"
  fi
  ;;
esac
case "$*" in *-g*|*--global*)
  for _js in __PREFIX__/lib/node_modules/*/bin/*.js \
             __PREFIX__/lib/node_modules/@*/*/bin/*.js; do
    [ -f "$_js" ] || continue
    head -1 "$_js" | grep -q '^#!/usr/bin/env node$' || continue
    sed -i "1s|#!/usr/bin/env node|#!__BIN_DIR__/node|" "$_js"
  done
  ;;
esac
exit $_npm_exit
NPMWRAP
    sed -i "s|__PREFIX__|$PREFIX|g; s|__BIN_DIR__|$BIN_DIR|g; s|__NODE_DIR__|$NODE_DIR|g" "$BIN_DIR/npm"
    chmod +x "$BIN_DIR/npm"
  fi

  if [ -f "$NODE_DIR/lib/node_modules/npm/bin/npx-cli.js" ]; then
    cat > "$BIN_DIR/npx" <<'NPXWRAP'
#!__PREFIX__/bin/bash
exec "__BIN_DIR__/node" "__NODE_DIR__/lib/node_modules/npm/bin/npx-cli.js" "$@"
NPXWRAP
    sed -i "s|__PREFIX__|$PREFIX|g; s|__BIN_DIR__|$BIN_DIR|g; s|__NODE_DIR__|$NODE_DIR|g" "$BIN_DIR/npx"
    chmod +x "$BIN_DIR/npx"
  fi

  if [ -f "$NODE_DIR/bin/corepack" ] && head -1 "$NODE_DIR/bin/corepack" 2>/dev/null | grep -q '#!/usr/bin/env node'; then
    sed -i "1s|#!/usr/bin/env node|#!$BIN_DIR/node|" "$NODE_DIR/bin/corepack"
  fi
}

install_nodejs() {
  local installed_ver=""
  local tmp_dir

  if [ -x "$BIN_DIR/node" ] && "$BIN_DIR/node" --version >/dev/null 2>&1; then
    installed_ver="$("$BIN_DIR/node" --version | sed 's/^v//')"
    if [ "$installed_ver" = "$NODE_VERSION" ]; then
      info "Node.js v$installed_ver already installed."
      create_node_wrappers
      return
    fi
  fi

  info "Downloading Node.js v$NODE_VERSION linux-arm64..."
  mkdir -p "$NODE_DIR"
  tmp_dir="$(mktemp -d "$PREFIX/tmp/clawmobile-node.XXXXXX")"
  trap "rm -rf '$tmp_dir'" EXIT

  curl -fL --max-time 300 "$NODE_URL" -o "$tmp_dir/$NODE_TARBALL"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$tmp_dir/$NODE_TARBALL" -C "$NODE_DIR" --strip-components=1

  create_node_wrappers
  export PATH="$BIN_DIR:$NODE_DIR/bin:$PATH"
  "$BIN_DIR/npm" config set script-shell "$PREFIX/bin/sh" 2>/dev/null || true
  rm -rf "$tmp_dir"
  trap - EXIT
}

install_compat_files() {
  [ -f "$COMPAT_DIR/glibc-compat.js" ] || die "missing $COMPAT_DIR/glibc-compat.js."
  [ -f "$COMPAT_DIR/systemctl" ] || die "missing $COMPAT_DIR/systemctl."
  [ -f "$COMPAT_DIR/patch-openclaw-paths.sh" ] || die "missing $COMPAT_DIR/patch-openclaw-paths.sh."

  mkdir -p "$PATCH_DIR"
  cp "$COMPAT_DIR/glibc-compat.js" "$PATCH_DIR/glibc-compat.js"
  cp "$COMPAT_DIR/systemctl" "$PREFIX/bin/systemctl"
  chmod +x "$PREFIX/bin/systemctl"
}

resolve_npm_registry() {
  local registry="$NPM_REGISTRY_ORIGIN"
  if [ -n "${NPM_CONFIG_REGISTRY:-}" ]; then
    registry="$NPM_CONFIG_REGISTRY"
  elif curl -sI --connect-timeout 5 "$NPM_REGISTRY_ORIGIN" >/dev/null 2>&1; then
    registry="$NPM_REGISTRY_ORIGIN"
  elif curl -sI --connect-timeout 5 "$NPM_REGISTRY_MIRROR" >/dev/null 2>&1; then
    registry="$NPM_REGISTRY_MIRROR"
    info "Using npm registry mirror: $registry"
  fi

  printf '%s' "$registry" > "$PROJECT_DIR/.npm-registry"
  export NPM_CONFIG_REGISTRY="$registry"
}

remove_bashrc_block() {
  local start="$1"
  local end="$2"
  local bashrc="$HOME/.bashrc"
  if [ -f "$bashrc" ] && grep -qF "$start" "$bashrc"; then
    sed -i "\|$start|,\|$end|d" "$bashrc"
  fi
}

write_shell_env() {
  local bashrc="$HOME/.bashrc"
  local start="# >>> ClawMobile Lite OpenClaw Android >>>"
  local end="# <<< ClawMobile Lite OpenClaw Android <<<"

  touch "$bashrc"
  remove_bashrc_block "$start" "$end"
  remove_bashrc_block "# >>> OpenClaw on Android >>>" "# <<< OpenClaw on Android <<<"

  {
    echo ""
    echo "$start"
    echo "export PATH=\"$BIN_DIR:$NODE_DIR/bin:\$HOME/.local/bin:\$PATH\""
    echo "export TMPDIR=\"$PREFIX/tmp\""
    echo "export TMP=\"\$TMPDIR\""
    echo "export TEMP=\"\$TMPDIR\""
    echo "export OA_GLIBC=1"
    echo "export CONTAINER=1"
    echo "export CLAWDHUB_WORKDIR=\"\$HOME/.openclaw/workspace\""
    echo "export CPATH=\"\$PREFIX/include/glib-2.0:\$PREFIX/lib/glib-2.0/include\""
    echo "[ -z \"\${NPM_CONFIG_REGISTRY:-}\" ] && [ -s \"$PROJECT_DIR/.npm-registry\" ] && export NPM_CONFIG_REGISTRY=\"\$(cat \"$PROJECT_DIR/.npm-registry\")\""
    echo "$end"
  } >> "$bashrc"
}

install_openclaw_package() {
  local openclaw_dir=""
  local clawdhub_dir=""

  export PATH="$BIN_DIR:$NODE_DIR/bin:$PATH"
  export TMPDIR="$PREFIX/tmp"
  export TMP="$TMPDIR"
  export TEMP="$TMPDIR"
  export OA_GLIBC=1
  export CONTAINER=1
  export CLAWDHUB_WORKDIR="$HOME/.openclaw/workspace"
  export CPATH="$PREFIX/include/glib-2.0:$PREFIX/lib/glib-2.0/include"

  python -c "import yaml" 2>/dev/null || pip install pyyaml -q || true

  if npm list -g openclaw >/dev/null 2>&1 || [ -d "$PREFIX/lib/node_modules/openclaw" ]; then
    info "Existing OpenClaw install detected; reinstalling package cleanly..."
    npm uninstall -g openclaw 2>/dev/null || true
    rm -rf "$PREFIX/lib/node_modules/openclaw" 2>/dev/null || true
    rm -rf "$HOME/.npm/_cacache" 2>/dev/null || true
  fi

  info "Installing $OPENCLAW_NPM_SPEC..."
  npm install -g "$OPENCLAW_NPM_SPEC" --ignore-scripts --no-fund --no-audit

  openclaw_dir="$(npm root -g)/openclaw"
  if [ -d "$openclaw_dir" ]; then
    info "Restoring OpenClaw bundled optional dependencies..."
    (cd "$openclaw_dir" && npm_config_ignore_scripts=true node scripts/postinstall-bundled-plugins.mjs 2>/dev/null) || true
  fi

  bash "$COMPAT_DIR/patch-openclaw-paths.sh"

  if [ "$INSTALL_CLAWDHUB" != "0" ]; then
    info "Installing clawdhub skill manager..."
    if npm install -g clawdhub --no-fund --no-audit; then
      clawdhub_dir="$(npm root -g)/clawdhub"
      if [ -d "$clawdhub_dir" ] && ! (cd "$clawdhub_dir" && node -e "require('undici')" 2>/dev/null); then
        (cd "$clawdhub_dir" && npm install undici --no-fund --no-audit) || warn "undici install failed; clawdhub may not work."
      fi
    else
      warn "clawdhub installation failed; ClawMobile Lite can still use local seeded skills."
    fi
  fi

  mkdir -p "$HOME/.openclaw"

  if [ "$RUN_OPENCLAW_UPDATE" != "0" ]; then
    info "Running openclaw update..."
    openclaw update || true
  fi
}

verify_install() {
  export PATH="$BIN_DIR:$NODE_DIR/bin:$PATH"
  hash -r

  "$BIN_DIR/node" --version >/dev/null || die "Node.js wrapper verification failed."
  "$BIN_DIR/npm" --version >/dev/null || die "npm wrapper verification failed."

  if command -v openclaw >/dev/null 2>&1; then
    info "OpenClaw installed: $(openclaw --version 2>/dev/null || true)"
  else
    die "openclaw is still not in PATH."
  fi
}

info "Installing OpenClaw directly in Termux with ClawMobile Lite bootstrap..."
info "Reference implementation inspected: https://github.com/AidanPark/openclaw-android"
info "This script does not clone the upstream installer."

require_aarch64
ensure_dirs
install_termux_packages
install_glibc_runner
install_compat_files
install_nodejs
resolve_npm_registry
write_shell_env
install_openclaw_package
verify_install

info "Install complete. New shells will load the ClawMobile Lite OpenClaw environment automatically."

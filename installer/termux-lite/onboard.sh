#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

clawmobile_require_termux
clawmobile_lite_env
clawmobile_require_openclaw

exec openclaw onboard --skip-daemon "$@"

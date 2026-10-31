#!/usr/bin/env bash
# anti-gaming-guard.sh — thin wrapper delegating to anti-gaming-guard.ts. The module IS the
# definition; the `.sh` wraps it for quay gate invocation.
#
# Usage:
#   anti-gaming-guard.sh --cov-source <machine|subjective> --cov-capped <true|false> \
#                         --cov-inflatable <true|false> --adjudication <pursue|abandon|fold|none> [--json]
#
# Exit codes: 0 = PASS (all checks pass); 1 = FAIL (one or more checks fail); 2 = usage/environment error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 --cov-source <machine|subjective> --cov-capped <true|false> --cov-inflatable <true|false> --adjudication <pursue|abandon|fold|none> [--json]" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/dist/anti-gaming-guard.js" "$@"
exit $?

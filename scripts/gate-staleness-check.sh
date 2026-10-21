#!/usr/bin/env bash
# gate-staleness-check.sh — bash wrapper for the gate-ledger freshness probe (SPEC §7 risk 1).
# The gate engine was ~24h idle; a mechanism that isn't running is indistinguishable from one that
# passes. This is the "最近一次执行时刻 vs 声称周期" check: the TS probe reads
# <root>/.quay/gate-events.jsonl, takes the most recent event timestamp, and reports when it is
# older than the claimed period. The bash layer is a thin arg pass-through — all judgment lives in
# gate-staleness-check.ts (single source).
#
# The Contract invoke surface is `bash plugin/scripts/gate-staleness-check.sh --json`; exit code:
#   0 = fresh, 1 = stale (or ledger missing / gate never ran), 2 = usage/environment error.
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
timeout=""
root_arg=""
mode="measure"

usage() { sed -n 's/^# \{0,1\}//p' "$0" | grep -v '^!' ; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --timeout) timeout="${2:-}"; shift 2 ;;
    --root) root_arg="${2:-}"; shift 2 ;;
    --json) mode="json"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "gate-staleness-check: unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -n "${timeout}" ]; then
  case "${timeout}" in ''|*[!0-9]*) echo "gate-staleness-check: --timeout must be a non-negative integer: ${timeout}" >&2; exit 2 ;; esac
fi

if ! command -v node >/dev/null 2>&1; then
  echo "gate-staleness-check: node required" >&2
  exit 2
fi

args=()
if [ "${mode}" = "json" ]; then args+=( "--json" ); fi
if [ -n "${timeout}" ]; then args+=( "--timeout" "${timeout}" ); fi
if [ -n "${root_arg}" ]; then args+=( "--root" "${root_arg}" ); fi

exec node --no-warnings --experimental-strip-types "${SCRIPT_DIR}/dist/gate-staleness-check.js" "${args[@]}"

#!/usr/bin/env bash
# drivable-workspace-check.sh — thin wrapper delegating to drivable-workspace-check.ts (module IS
# the definition; mirrors the it0-dod-check.sh/.ts wrapper shape).
#
# Usage:
#   drivable-workspace-check.sh <path> [<path> ...] --registry <file>
#
# --registry is REQUIRED (DIR-120-B, 2026-07-28) — the underlying .ts module removed its
# directory-relative-guess default; an omitted --registry is enforced (and reported) by the .ts
# module itself, not duplicated here.
#
# Exit codes: 0 = all paths covered; 1 = at least one path NOT covered; 2 = usage/environment error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <path> [<path> ...] --registry <file>" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/dist/drivable-workspace-check.js" "$@"
exit $?

#!/usr/bin/env bash
# task-schema-check.sh — canonical task-schema check (canonical-task-schema unit B2).
# Thin wrapper delegating to task-schema-check.ts.
# Usage: task-schema-check.sh <task-file.md> [<task-file.md> ...]
# Exit: 0 = no FAILs; 1 = >=1 marked task FAILs; 2 = usage/environment error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi

source "$(dirname "$0")/gate-script-lib.sh"
gate_delegate_ts "dist/task-schema-check.js" 1 "<task-file.md> [<task-file.md> ...]" "$@"

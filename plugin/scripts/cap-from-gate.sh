#!/usr/bin/env bash
# plugin/scripts/cap-from-gate.sh — thin bash wrapper over cap-from-gate.ts (the module IS the
# definition). Exists so the task's Contract invocation form `bash <cap-from-gate-helper>` works
# literally; the tick and the operator can call either this or `node --experimental-strip-types
# plugin/scripts/cap-from-gate.ts`. Mirrors the it0-*-check.sh wrapper convention.
#
# Usage:
#   bash plugin/scripts/cap-from-gate.sh [--root <repo>] [--state <file>] [--samples <n>]
#
# Output: signal/band lines + a LAST `effective_cap=N` line (the digit the dispatch decision reads).
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node --experimental-strip-types "$SCRIPT_DIR/cap-from-gate.ts" "$@"

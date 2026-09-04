#!/usr/bin/env bash
# plugin/scripts/slot-refill.sh — thin bash wrapper over slot-refill.ts (the module IS the
# definition). Exists so the tick's Contract invocation form `bash plugin/scripts/slot-refill.sh`
# works literally; mirrors the it0-*-check.sh / cap-from-gate.sh wrapper convention.
#
# Usage:
#   bash plugin/scripts/slot-refill.sh [--root <repo>] [--cap <n>] [--json]
#
# Output: `REFILL GO: ...` | `REFILL NO-GO: <reason>` (a detector/evaluator — exits 0 always,
# dispatches nothing; the tick's dispatch decision consumes the GO/NO-GO).
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node --experimental-strip-types "$SCRIPT_DIR/slot-refill.ts" "$@"

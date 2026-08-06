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
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node --experimental-strip-types "$SCRIPT_DIR/slot-refill.ts" "$@"

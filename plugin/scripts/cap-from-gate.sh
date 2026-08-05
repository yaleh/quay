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
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node --experimental-strip-types "$SCRIPT_DIR/cap-from-gate.ts" "$@"

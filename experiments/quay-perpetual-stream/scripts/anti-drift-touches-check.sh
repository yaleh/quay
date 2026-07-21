#!/usr/bin/env bash
# anti-drift-touches-check.sh — thin wrapper over anti-drift-touches-check.mjs (DIR-044 increment 4).
# The NON-WAIVABLE after-the-fact HARD guardrail. Mirrors task-schema-check.sh shape.
#   Usage: anti-drift-touches-check.sh <ran-batch-manifest.json>
#   Exit:  0 = clean; 1 = HARD FAIL (out-of-declared write or cross-build overlap); 2 = usage/env error.
set -u
if [ "$#" -lt 1 ]; then echo "Usage: $0 <ran-batch-manifest.json>" >&2; exit 2; fi
if ! command -v node >/dev/null 2>&1; then echo "ERROR: node required" >&2; exit 2; fi
node "$(dirname "$0")/anti-drift-touches-check.mjs" "$@"
exit $?

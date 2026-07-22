#!/usr/bin/env bash
# task-schema-check.sh — canonical task-schema check (exp5 / canonical-task-schema unit B2). Thin
# wrapper delegating to task-schema-check.mjs — mirrors it0-dod-check.sh's exact wrapper shape
# (usage/arg check, node availability check, delegate, propagate exit code), the same
# `*-check.sh` wraps `*-check.mjs` convention as every existing pair in `scripts/`. This is the
# loop-facing entrypoint (OUTER-LOOP SELECT and /quay-directive invoke it).
#
# Usage:
#   task-schema-check.sh <task-file.md> [<task-file.md> ...]
#
# Exit codes: 0 = no FAILs (N/A-legacy is OK); 1 = >=1 marked task FAILs; 2 = usage/environment error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <task-file.md> [<task-file.md> ...]" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/task-schema-check.ts" "$@"
exit $?

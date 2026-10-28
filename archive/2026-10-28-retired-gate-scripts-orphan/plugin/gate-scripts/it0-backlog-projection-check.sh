#!/usr/bin/env bash
# it0-backlog-projection-check.sh — backlog-projection anti-drift check, M24-task-backlog-
# projection-impl Stage 4.2 (DIR-015 item 2 / m13 design doc §13). Mirrors M05-dir-projection's
# it0-dir-projection-check.{sh,mjs} precedent for the `backlog.md` generated view over
# `label: milestone-candidate` tasks. See it0-backlog-projection-check.ts's header comment for
# the full STALE-VIEW / GROUPING-DISAGREEMENT failure-mode descriptions.
#
# Usage:
#   it0-backlog-projection-check.sh <experiment-dir>
#
# Exit codes: 0 = PASS; 1 = FAIL (divergence found); 2 = usage/data error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <experiment-dir>" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/it0-backlog-projection-check.ts" "$1"
exit $?

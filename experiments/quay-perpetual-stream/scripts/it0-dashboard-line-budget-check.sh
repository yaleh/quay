#!/usr/bin/env bash
# it0-dashboard-line-budget-check.sh — dashboard context-budget gate (DIR-054 / M78).
#
# HARD-FAILS (exit non-zero) when experiments/quay-perpetual-stream/dashboard.md exceeds
# the 1200-line cap. The cap enforces a rolling-window discipline: the ## Log section must
# retain only the last ~5 milestones; older entries are archived to dashboard-archive/.
#
# Usage:
#   it0-dashboard-line-budget-check.sh [dashboard-file]
#
# Arguments:
#   dashboard-file  Path to the dashboard markdown file to check.
#                   Defaults to: experiments/quay-perpetual-stream/dashboard.md
#                   (relative to the repo root; the script resolves relative to its own
#                   location if run from anywhere).
#
# Exit codes:
#   0 = PASS  — file is under the 1200-line cap.
#   1 = FAIL  — file meets or exceeds the 1200-line cap; trim ## Log section before ABSORB.
#   2 = usage/file-not-found error.

set -u

CAP=1200

# Default: resolve relative to script location. scripts/ sits three levels below the repo
# root: <repo>/experiments/quay-perpetual-stream/scripts/ → ../../.. is <repo>.
# (Was ../../../.. — one level too many, resolving to the repo's PARENT, so the default
# dashboard path was never found and the gate errored (exit 2) instead of measuring. DIR-054 fix.)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DEFAULT_DASHBOARD="$REPO_ROOT/experiments/quay-perpetual-stream/dashboard.md"

DASHBOARD="${1:-$DEFAULT_DASHBOARD}"

if [ ! -f "$DASHBOARD" ]; then
  echo "ERROR: dashboard file not found: $DASHBOARD" >&2
  exit 2
fi

line_count=$(wc -l < "$DASHBOARD")

if [ "$line_count" -lt "$CAP" ]; then
  echo "PASS: $DASHBOARD — $line_count lines (cap $CAP). Dashboard is within the line budget."
  exit 0
fi

echo "FAIL: $DASHBOARD — $line_count lines meets or exceeds the cap of $CAP lines."
echo "Trim the ## Log section (archive old entries to dashboard-archive/) before completing ABSORB."
echo "The rolling-window discipline: retain only the last ~5 milestones in ## Log."
exit 1

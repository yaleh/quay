#!/usr/bin/env bash
# it0-split-or-commit-check.sh — split-or-commit enforcement gate (DIR-026). Thin
# wrapper delegating to it0-split-or-commit-check.ts — same `*-check.sh` wraps `*-check.ts`
# convention as every existing pair in `scripts/`.
#
# Usage:
#   it0-split-or-commit-check.sh [--allow-empty] [--tasks-dir <dir>] <workspace-root>
#   it0-split-or-commit-check.sh --selftest
#
# Exit codes: 0 = PASS; 1 = violations found (incl. empty-set fail-closed: an empty task set is
# indistinguishable from 'never looked' unless --allow-empty is passed); 2 = usage/environment error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 [--allow-empty] [--tasks-dir <dir>] <workspace-root>" >&2
  echo "       $0 --selftest" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/it0-split-or-commit-check.ts" "$@"
exit $?

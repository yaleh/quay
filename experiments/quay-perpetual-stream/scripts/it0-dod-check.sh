#!/usr/bin/env bash
# it0-dod-check.sh — DoD meta-enforcer, DIR-017 Step 1 (M25-dod-meta-enforcer). Thin wrapper,
# mirrors it0-backlog-projection-check.sh's exact wrapper shape: usage/arg check, node
# availability check, delegates to the .mjs, propagates its exit code. See it0-dod-check.mjs's
# header comment for the full spec (4 DoD clauses + no-self-exemption meta-check).
#
# Usage:
#   it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-file>
#
# Exit codes: 0 = PASS; 1 = FAIL (at least one clause violation, or undeclared self-exemption);
# 2 = usage/environment error.

set -u

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <milestone-id> <charter-file> <absorb-entry-file>" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/it0-dod-check.mjs" "$1" "$2" "$3"
exit $?

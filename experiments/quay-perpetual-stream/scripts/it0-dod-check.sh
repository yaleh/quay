#!/usr/bin/env bash
# it0-dod-check.sh — DoD meta-enforcer, charter M25-dod-meta-enforcer (DIR-017 Step 1). Thin
# wrapper delegating to it0-dod-check.mjs — mirrors it0-backlog-projection-check.sh's exact
# wrapper shape (usage/arg check, node availability check, delegate, propagate exit code), the
# same `it0-*-check.sh` wraps `it0-*-check.mjs` convention as every existing pair in `scripts/`.
#
# Given a milestone id, a charter file path, and an ABSORB-entry text file, runs all 5 DoD clauses
# defined in inherited-core.md's "Definition of Done" section. See it0-dod-check.mjs's own header
# comment for the full per-clause implementation.
#
# Usage:
#   it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-file>
#
# Exit codes: 0 = PASS (all clauses satisfied); 1 = FAIL (clause violation or undeclared self-
# exemption); 2 = usage/environment error.

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

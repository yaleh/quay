#!/usr/bin/env bash
# derive-touches-heuristic-selfcheck.sh — sibling test entrypoint for derive-touches-heuristic.ts
# (DIR-113 item 1). Unlike this directory's fixture-exit-code selfchecks (task-schema-selfcheck.sh
# et al., which assert an external check script's PASS/FAIL exit code against fixtures),
# derive-touches-heuristic.ts is a DERIVATION tool, not a pass/fail gate — its correctness is
# assertion-based (extraction/resolution correctness, including the DIR-113 AC1 real-repo
# superset demonstration against DIR-109's pre-charter body). So this wrapper execs the real
# node:test file directly, which is coverage-measurable (`--experimental-test-coverage`).
#
# Exit: 0 = all assertions pass; non-zero = >=1 assertion failed or node/file missing.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_FILE="$SCRIPT_DIR/derive-touches-heuristic.test.ts"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

if [ ! -f "$TEST_FILE" ]; then
  echo "ERROR: sibling test not found: $TEST_FILE" >&2
  exit 2
fi

exec node --experimental-strip-types --test "$TEST_FILE"

#!/usr/bin/env bash
# Mutation case for test-impl-census-check (gap-experiment-legacy-reclaim-and-touches-heuristic AC5:
# impl-deleted test files are flagged so they can never silently re-accumulate). Its --selftest runs
# fixture assertions in BOTH directions: an impl-deleted test (imports a scripts/ module that exists
# nowhere) MUST be flagged RED; live tests, mirror-symlink tests, and mechanism tests with no
# scripts/ import MUST stay GREEN.
set -u
name="test-impl-census-check"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node --no-warnings --experimental-strip-types "${checker_dir}/test-impl-census-check.ts" --selftest
code=$?
if [ "$code" -eq 0 ]; then
  exit 0
else
  echo "case FAILED: checker --selftest exited $code" >&2
  exit 2
fi

#!/usr/bin/env bash
# test-framework-policy-check.sh — node:test policy + shrink-only exemption ratchet
# (gap-no-test-framework-policy-for-new-tests, AC1-AC8). Thin wrapper delegating to
# test-framework-policy-check.ts — same `*-check.sh` wraps `*-check.ts` convention as
# every existing pair in `plugin/scripts/`.
#
# Usage:
#   test-framework-policy-check.sh <workspace-root>
#   test-framework-policy-check.sh --selftest
#
# Exit codes: 0 = PASS; 1 = violations found; 2 = usage/environment error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <workspace-root>" >&2
  echo "       $0 --selftest" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/test-framework-policy-check.ts" "$@"
exit $?

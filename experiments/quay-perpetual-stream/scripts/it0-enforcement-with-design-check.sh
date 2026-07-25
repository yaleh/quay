#!/usr/bin/env bash
# it0-enforcement-with-design-check.sh — enforcement-with-design invariant gate (ADR-011).
# Thin wrapper delegating to it0-enforcement-with-design-check.ts — same `*-check.sh` wraps
# `*-check.ts` convention as every existing pair in `scripts/`.
#
# Usage:
#   it0-enforcement-with-design-check.sh <workspace-root>
#   it0-enforcement-with-design-check.sh --selftest
#
# Exit codes: 0 = PASS; 1 = FAIL (unenforced clause found); 2 = usage/environment error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 [--root <dir>] [--inherited-core <path>] [--dod-check <path>] <workspace-root>" >&2
  echo "       $0 --selftest" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/it0-enforcement-with-design-check.ts" "$@"
exit $?

#!/usr/bin/env bash
# loadbearing-test-gate.sh — the load-bearing test-gate (exp5-M-CRYST-B7-LOADBEARING-TEST-GATE, the
# mechanical enforcement of ADR-001 Decision clause 2). Thin wrapper delegating to
# loadbearing-test-gate.mjs — mirrors vmeta-lag-check.sh / task-schema-check.sh's exact wrapper shape
# (usage/arg check, node availability check, delegate, propagate exit code), the same `*-check`/`*-gate`
# wraps `*.mjs` convention as every existing pair in `scripts/`. A future
# `quay gate --gate loadbearing-test` WRAPS the same loadbearing-test-gate.mjs module (M39 registry
# precedent) — it must NEVER reimplement the enumeration/detection logic; this wrapper and that gate
# are two invocation surfaces over ONE single-source module.
#
# Usage:
#   loadbearing-test-gate.sh --scripts <dir> [--tests <dir>] [--import-root <dir> ...] \
#                            [--registry <file>] [--outer-loop <file>]
#
# Exit codes: 0 = PASS (every load-bearing script has a sibling *.test.mjs); 1 = FAIL (>=1 load-bearing
# script lacks a sibling test); 2 = usage/environment error.

set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 --scripts <dir> [--tests <dir>] [--import-root <dir> ...] [--registry <file>] [--outer-loop <file>]" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/loadbearing-test-gate.ts" "$@"
exit $?

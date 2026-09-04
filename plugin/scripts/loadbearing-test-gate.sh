#!/usr/bin/env bash
# loadbearing-test-gate.sh — the load-bearing test-gate (M-CRYST-B7-LOADBEARING-TEST-GATE, the
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
#                            [--registry <file>] [--outer-loop <file>] [--allow-empty]
#
# Exit codes: 0 = PASS (every load-bearing script has a sibling *.test.mjs or *.test.ts); 1 = FAIL (>=1
# load-bearing script lacks a sibling test, or the scripts dir is EMPTY — an empty dir is
# indistinguishable from 'never looked' unless --allow-empty is passed); 2 = usage/environment error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 --scripts <dir> [--tests <dir>] [--import-root <dir> ...] [--registry <file>] [--outer-loop <file>] [--allow-empty]" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/loadbearing-test-gate.ts" "$@"
exit $?

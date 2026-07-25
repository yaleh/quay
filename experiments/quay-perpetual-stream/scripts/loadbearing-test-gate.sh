#!/usr/bin/env bash
# loadbearing-test-gate.sh — load-bearing test-gate (ADR-001 Decision clause 2, mechanical enforcement).
# Thin wrapper delegating to loadbearing-test-gate.ts.
# Usage: loadbearing-test-gate.sh --scripts <dir> [--tests <dir>] [--import-root <dir> ...]
#        [--registry <file>] [--outer-loop <file>]
# Exit: 0 = PASS; 1 = >=1 script lacks sibling test; 2 = usage/environment error.

source "$(dirname "$0")/gate-script-lib.sh"
gate_delegate_ts "loadbearing-test-gate.ts" 1 \
  "--scripts <dir> [--tests <dir>] [--import-root <dir> ...] [--registry <file>] [--outer-loop <file>]" \
  "$@"

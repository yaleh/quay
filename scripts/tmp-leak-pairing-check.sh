#!/usr/bin/env bash
# tmp-leak-pairing-check.sh — mechanical gate: every mkdtemp/mkdtempSync result in a test file
# MUST be paired with a cleanup (rmSync / after() carrier / caller-cleans-return). Thin wrapper
# delegating to tmp-leak-pairing-check.ts — same `*-check.sh` wraps `*-check.ts` convention as
# every existing pair in `plugin/scripts/`.
#
# BLOCKS (exit 1) on any unpaired mkdtemp — unlike test-isolation-check's R6 rule, which reports
# the same class but is baselined (报出而不阻断). The corpus is expected to be at ZERO unpaired
# mkdtemps after the 2026-08-12 /tmp leak fix; a regression (a fixed file re-leaking, or a new
# unpaired mkdtemp) goes RED and aborts the suite (set -euo pipefail in scripts/test.sh).
#
# Usage:
#   tmp-leak-pairing-check.sh <workspace-root>
#   tmp-leak-pairing-check.sh --selftest
#
# Exit codes: 0 = every mkdtemp is paired with cleanup; 1 = violations found; 2 = usage/env error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
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

node "$(dirname "$0")/dist/tmp-leak-pairing-check.js" "$@"
exit $?

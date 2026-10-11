#!/usr/bin/env bash
# test-isolation-check.sh — test-isolation contract scan + shrink-only violation ratchet
# (gap-test-isolation-contract-is-unwritten, AC1-AC8). Thin wrapper delegating to
# test-isolation-check.ts — same `*-check.sh` wraps `*-check.ts` convention as every existing
# pair in `plugin/scripts/`.
#
# The check REPORTS the current contract violations but does NOT block on the known/baselined
# ones (AC6, "报出而不阻断"); it FAILS only on ratchet drift (a new violation, a grown/stale
# list — AC5). It is wired into scripts/test.sh's run_static_checks so every test-running
# invocation (default, --group, --for-task, flags-only, explicit files) sees it; the metadata
# modes --list-files/--list-groups skip it.
#
# Usage:
#   test-isolation-check.sh <workspace-root>
#   test-isolation-check.sh --selftest
#
# Exit codes: 0 = report-only / all violations baselined; 1 = ratchet violation; 2 = env error.

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

node "$(dirname "$0")/dist/test-isolation-check.js" "$@"
exit $?

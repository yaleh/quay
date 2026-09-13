#!/usr/bin/env bash
# it0-split-or-commit-check.sh — split-or-commit enforcement gate (DIR-026). Thin
# wrapper delegating to it0-split-or-commit-check.ts — same `*-check.sh` wraps `*-check.ts`
# convention as every existing pair in `scripts/`.
#
# Usage:
#   it0-split-or-commit-check.sh [--allow-empty] [--tasks-dir <dir>] <workspace-root>
#   it0-split-or-commit-check.sh --changed [--base <ref>] [--only <id,id,…>] <workspace-root>
#   it0-split-or-commit-check.sh --selftest
#
# `--changed` = the delta-scoped mode registered as the change-tier companion
# (gap-it0-split-or-commit-check-needs-change-tier-companion): the whole-store rules judged against
# the DELTA's task files + their 1-hop neighbours only, so the task that breaks a relation pays at
# its OWN scoped gate instead of an unrelated task's full-suite fan-in. `NOT-EVALUATED:` + exit 0
# when the delta carries no task file (scoped-safe — ⛔ never exit 3 here: the scoped runner evals
# raw commands under `set -euo pipefail`).
#
# Exit codes: 0 = PASS (also NOT-EVALUATED in --changed mode); 1 = violations found (incl. empty-set
# fail-closed: an empty task set is indistinguishable from 'never looked' unless --allow-empty is
# passed); 2 = usage/environment error.

# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 [--allow-empty] [--tasks-dir <dir>] <workspace-root>" >&2
  echo "       $0 --changed [--base <ref>] [--only <id,id,…>] <workspace-root>" >&2
  echo "       $0 --selftest" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node required" >&2
  exit 2
fi

node "$(dirname "$0")/it0-split-or-commit-check.ts" "$@"
exit $?

#!/usr/bin/env bash
# integration-batch-merge.sh — THIN ENTRY over integration-batch-merge.ts (the batch-merge helper of
# the two-line branch model; tasks/gap-arch-tsify-integration-batch-merge-sh, SPEC-architecture-
# consolidation §5 Phase 5.2).
#
# The body (batch merge, the three pre-merge gates, the real-merge temp worktree, the reverse-edge
# conflict direction, `--reconcile`, and the fan-in mode) lives in ONE implementation —
# `${CLAUDE_PLUGIN_ROOT}/scripts/dist/integration-batch-merge.js` — because the `.sh` path is the written-down interface:
# every caller, every test (plugin/test/integration-batch-merge{,-characterization}.test.mjs,
# branch-model, sync-lag-check) and the branch-model docs invoke `bash plugin/scripts/
# integration-batch-merge.sh …`. This wrapper keeps that form working and nothing else:
#   1. resolve its own directory (works in the repo, in a task worktree, in an installed bundle);
#   2. exec the implementation with the caller's argv, unchanged.
#
# --help is NOT special-cased here (unlike the other thin wrappers): the usage text IS the
# implementation's documented contract (modes / three gates / reverse edge / exit codes), so routing
# the flag through to the module keeps `bash plugin/scripts/integration-batch-merge.sh --help`
# byte-identical to the pre-rewrite bash. A wrapper-local `tool_help "$0"` would print this stub.
#
# Usage / modes / gates / exit codes: `bash plugin/scripts/integration-batch-merge.sh --help`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec node --no-warnings --experimental-strip-types "${SCRIPT_DIR}/dist/integration-batch-merge.js" "$@"

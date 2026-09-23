#!/usr/bin/env bash
# cross-machine-verify.sh — cross-machine VERIFICATION of post-merge delivery.
#
# THIN ENTRY (gap-arch-tsify-cross-machine-verify-sh; SPEC-architecture-consolidation §5 Phase 5.2).
# The program — the merge-note/verdict-note protocol, the fail-closed preflight, the fast-gate runner
# and every JSON transform — lives in
#     plugin/scripts/cross-machine-verify.ts
# and this wrapper exists because `cross-machine-verify.sh` is a WRITTEN-DOWN interface that must not
# break: `plugin/scripts/periodic-push-backup.sh` invokes it by that exact path (twice), the loop docs
# reference it, and the capability catalog declares it by this basename. It is deliberately THIN — one
# implementation, not two — so the entry form and the behavior can never drift apart.
#
# It does three things and nothing else:
#   1. resolve its own directory (works in the repo, in a task worktree, and from any cwd);
#   2. fail closed with a CAUSE when the implementation is not beside it — an entry whose program is
#      absent must NOT print an empty report that reads as 「nothing to verify」;
#   3. exec the implementation with the caller's argv, unchanged.
#
# All modes / output shapes / exit codes are the implementation's (its header is the usage 正本).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd -P)"
IMPL="${SCRIPT_DIR}/cross-machine-verify.ts"

if [ ! -f "$IMPL" ]; then
  echo "CAUSE=cross-machine-verify-impl-missing — ${IMPL} not found, so the cross-machine verify entry cannot run (plugin root: ${SCRIPT_DIR}). Refusing to print an empty report as if every merge were verified." >&2
  exit 3
fi

# `--no-warnings` (the same flag `ff-merge.ts`'s sibling spawns prepend): this repo's package.json has
# no `"type": "module"`, so Node prints a MODULE_TYPELESS_PACKAGE_JSON warning on EVERY run. The
# pre-migration bash had a silent stderr, and callers read this script's stderr for the fail-closed
# CAUSEs — a per-run warning banner would sit in the middle of that channel for every caller.
exec node --no-warnings --experimental-strip-types "${IMPL}" "$@"

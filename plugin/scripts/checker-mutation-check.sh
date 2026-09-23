#!/usr/bin/env bash
# checker-mutation-check.sh — mutation-test the CHECKERS themselves (the L_S instrument).
#
# THIN ENTRY (gap-arch-tsify-checker-mutation-check-sh; SPEC-architecture-consolidation §5 Phase 5.2).
# The program — the manifest parser (run_static_checks / run_operational_checks / run_doc_checks / CI),
# the bounded-parallel case pool, the verdict vocabulary, the change-tier companion and the meta-mutation
# self-test — lives in
#     plugin/scripts/checker-mutation-check.ts
# and this wrapper exists because `checker-mutation-check.sh` is a WRITTEN-DOWN interface that must not
# break: `plugin/scripts/runner-static-gate.ts` invokes it by that exact path TWICE (the full-tier
# `--check` registration and the change-tier `--check-changed` companion), the capability catalog
# declares it by this basename, and the meta-selfcheck case
# (`plugin/scripts/checker-mutation-cases/checker-mutation-check.sh`) invokes it by this path. It is
# deliberately THIN — one implementation, not two — so the entry form and the behavior can never drift
# apart. The usage 正本 (modes, output shapes, exit codes, the case-script contract) is the `.ts` file's
# header; `--help` is routed there so `bash checker-mutation-check.sh --help` still prints it.
#
# It does three things and nothing else:
#   1. resolve its own directory (works in the repo, in a task worktree, through the experiments/**
#      symlinked mirrors, and from any cwd);
#   2. fail closed with a CAUSE when the implementation is not beside it — an entry whose program is
#      absent must NOT print an empty report that reads as 「nothing failed」;
#   3. exec the implementation with the caller's argv, unchanged.
#
# The `--no-warnings` flag (the same one `ff-merge.ts`'s sibling spawns prepend): this repo's
# package.json has no `"type": "module"`, so Node prints a MODULE_TYPELESS_PACKAGE_JSON warning on every
# run. Callers read this script's stdout as JSON (`--list --json` / `--run --json`) and read stderr for
# the fail-closed CAUSEs, so a per-run warning banner has no place in either channel.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd -P)"
IMPL="${SCRIPT_DIR}/checker-mutation-check.ts"

[ -f "$IMPL" ] || { echo "CAUSE=checker-mutation-check-impl-missing — ${IMPL} not found, so the mutation instrument cannot run (plugin root: ${SCRIPT_DIR}). Refusing to report 'no checker stayed green' without running a single case." >&2; exit 3; }

exec node --no-warnings --experimental-strip-types "${IMPL}" "$@"

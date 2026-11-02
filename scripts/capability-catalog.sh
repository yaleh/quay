#!/usr/bin/env bash
# capability-catalog.sh — the SINGLE ENTRY POINT of the capability catalog
# ("有哪些机件、各自回答什么问题" — the one inventory the project instructions point at).
#
# THIN ENTRY (gap-arch-catalog-declarations-leave-bash). The catalog's declarations live as DATA in
#     plugin/scripts/capability-catalog-declarations.json
# and its renderer + every gate live in
#     ${CLAUDE_PLUGIN_ROOT}/scripts/dist/capability-catalog.js
# This wrapper exists because `bash plugin/scripts/capability-catalog.sh <mode>` is a WRITTEN-DOWN
# interface that must not break: the project instructions call it the single inventory, package.sh
# runs `--entry-surface` on the staged artifact, and select-static-checks-for-touches.ts registers
# it as a scoped static check by that exact command line. It is deliberately THIN — one
# implementation, not two — so the entry form and the behavior can never drift apart.
#
# It does three things and nothing else:
#   1. resolve its own directory (works in the repo, in a task worktree, and in an installed
#      plugin bundle);
#   2. fail closed with a CAUSE when the renderer or its data file is not beside it — an entry
#      whose data is absent must NOT print an empty catalog that reads as "nothing to report";
#   3. exec the renderer with the caller's argv, unchanged.
#
# All modes / gates / output shapes are the renderer's (see its header for usage and exit codes).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd -P)"
# bash half of the repo-root pair (repo-root-unification AC2): kept a live consumer here so the
# pair stays consumed. The renderer resolves its own root through the TS half (repo-root.ts); the
# value below is used only to make a failure diagnosable in the right tree.
. "${SCRIPT_DIR}/repo-root.sh"

CATALOG_RENDERER="${SCRIPT_DIR}/dist/capability-catalog.js"
CATALOG_DECLARATIONS="${SCRIPT_DIR}/capability-catalog-declarations.json"

if [ ! -f "$CATALOG_RENDERER" ]; then
  echo "CAUSE=capability-catalog-renderer-missing — ${CATALOG_RENDERER} not found, so the catalog entry cannot run (plugin root: ${SCRIPT_DIR}; repo root: $(repoRoot "$SCRIPT_DIR"))." >&2
  exit 3
fi
if [ ! -f "$CATALOG_DECLARATIONS" ]; then
  echo "CAUSE=capability-catalog-declarations-missing — ${CATALOG_DECLARATIONS} not found, so the catalog has no declarations to render (repo root: $(repoRoot "$SCRIPT_DIR")). Refusing to print an empty catalog as if every check were declared." >&2
  exit 3
fi

# ⛔ KEEP THE SPELLING UNBRACED (`"$SCRIPT_DIR/dist/X.js"`, ⛔ not `"${SCRIPT_DIR}/dist/X.js"`). The braces are
# load-bearing: `build-plugin-dist.mjs`'s staged rewrite drops `--experimental-strip-types` ONLY for
# the unbraced form (rewriteShell's `exec node "$SCRIPT_DIR/dist/X.js"` rule).
# With the braced spelling the generic `${SCRIPT_DIR}/dist/X.js` → `${SCRIPT_DIR}/dist/X.js` rule rewrites
# the PATH but LEAVES the flag, so the shipped artifact ran `node --experimental-strip-types
# .../dist/capability-catalog.js` — a bundle that needs no flag — and every Node <22.6 rejected it
# with `node: bad option` (exactly the defect quay-init.sh documents for its own sibling). The dev
# tree still runs the raw .ts here (source needs Node >=22.6, which is already the dev floor).
exec node "$SCRIPT_DIR/dist/capability-catalog.js" "$@"

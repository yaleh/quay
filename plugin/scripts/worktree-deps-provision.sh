#!/usr/bin/env bash
# worktree-deps-provision.sh — thin entry for the task-worktree node_modules step.
#
# The program — the package-manager judgment, the declared-command read, the symlink/install/fallback
# provisioning — lives in worktree-deps-provision.ts, which delegates the SHARED decision to
# packages/quay/src/worktree-deps.ts (the SAME module the goal path's ensureWorktreeNodeModules
# imports). ⛔ One implementation, two callers, never a copy per caller.
#
# WHY a shell entry exists (the task that added this: gap-dispatch-worktree-setup-links-node-modules-
# for-pnpm-projects): `dispatch-worktree-setup.sh` is a pure-bash orchestrator and the sh-census
# ratchet is at ZERO slack — a direct `node …` line in that script would charge its whole ~140-line
# body to embeddedInterpreterLines. This entry is the boundary that keeps the .sh's census reading
# unchanged while still routing the deps step through the one TS judgment.
#
# It does three things and nothing else:
#   1. resolve its own directory (repo, task worktree, any cwd);
#   2. fail closed with a CAUSE when the implementation is not beside it;
#   3. exec the implementation with the caller's argv, unchanged.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd -P)"
IMPL="${SCRIPT_DIR}/worktree-deps-provision.ts"

if [ ! -f "$IMPL" ]; then
  echo "CAUSE=worktree-deps-provision-impl-missing — ${IMPL} not found, so the worktree dependency step cannot run (plugin root: ${SCRIPT_DIR})." >&2
  exit 3
fi

exec node --no-warnings --experimental-strip-types "${IMPL}" "$@"

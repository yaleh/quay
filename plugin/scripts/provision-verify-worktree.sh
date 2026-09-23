#!/usr/bin/env bash
# provision-verify-worktree.sh — provision a fresh git worktree so it can RUN the full suite.
# (manager 2026-08-10 family finding: fresh verify worktrees failed tonight because the gitignored
#  runtime files they need are absent — 11:12/11:31 AC4 "laid-down tick docs byte-identical",
#  13:14 AC11 "Cannot find repo root: no .quay/config.yml", 13:03 esbuild/node_modules. The existing
#  worktree-include.sh covers config.yml + vendor dist but EXPLICITLY EXCLUDES node_modules; this
#  script is the SHARED step for BOTH A15 ④ paths (suite-fix subagent + outer takeover) that composes
#  the two provisioning needs into one call.)
#
# WHAT IT DOES (the enumerated set, verified 2026-08-10):
#   1. Calls the EXISTING `worktree-include.sh` (declarative: copies gitignored files declared in
#      .worktreeinclude — .quay/config.yml, plugin/vendor/*/dist/*.js — into the worktree).
#   2. Symlinks <main>/node_modules → <worktree>/node_modules (worktree-include.sh EXPLICITLY
#      excludes node_modules "the build step symlinks/installs it" — that step is THIS symlink;
#      a fresh worktree has no deps → esbuild ERR_MODULE_NOT_FOUND, the 13:03 hit).
#
# If a future fresh-verify-worktree failure names a THIRD missing runtime file: add it to
# .worktreeinclude (for tracked-copy files) or to this script's link list (for symlink files) —
# the rule is "enumerate, don't patch one field" (manager 2026-08-10).
#
# TEARDOWN (--teardown) — gap-suite-leaks-live-claude-sessions: a fixture/worktree teardown must be
# COMPLETE — 删目录 + 回收进程 (the 4-orphan 109-120h leak: teardown only `rm -rf`'d the dir and left
# the live claude sessions behind). --teardown does BOTH, in the order that closes the leak:
#   1. RECLAIM PROCESSES — stop every `claude --settings <worktree>/...` session whose workspace is
#      under the worktree (orphan-session-check.ts --kill-workspace, SIGTERM→SIGKILL). The dir may
#      already be gone (the leak's exact shape) — the sessions are still addressable by their
#      --settings path, so teardown works on a half-deleted worktree too.
#   2. DELETE THE DIRECTORY — `git worktree remove --force` (when still registered) then `rm -rf`.
#
# Usage:
#   bash plugin/scripts/provision-verify-worktree.sh --worktree <path> [--root <main-repo>] [--teardown]
#
#   --worktree <path>   the verify worktree to provision (REQUIRED; for --teardown, the worktree to
#                       fully tear down — the dir may already be gone)
#   --root <main-repo>  the main checkout (default: auto-derived from this script's location)
#   --teardown          TEARDOWN MODE: stop the worktree's claude sessions + remove the worktree
#                       (dir + registration). Complete teardown, opposite of provision.
#   --dry-run           print what would be done, change nothing
#   --help              usage, exit 0
#
# Exit codes: 0 = provisioned (or already-provisioned, idempotent) / fully torn down; 2 = usage/env error.
#
# Idempotent: re-running on an already-provisioned worktree is a no-op (worktree-include re-copies
# overwriting; the node_modules symlink keeps an existing link). --teardown on an already-removed
# worktree is a no-op for the dir step and still reclaims any lingering sessions.

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "provision-verify-worktree.sh — provision a fresh verify worktree to run the full suite (config.yml+vendor dist via worktree-include, plus the node_modules symlink), or --teardown it completely (stop sessions + remove dir)"
  echo "usage: bash plugin/scripts/provision-verify-worktree.sh --worktree <path> [--root <main-repo>] [--teardown] [--dry-run]"
  exit 0
fi

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
default_root="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"

worktree=""
root="${default_root}"
dry_run=0
teardown=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --worktree) worktree="${2:-}"; shift 2 ;;
    --root) root="${2:-}"; shift 2 ;;
    --teardown) teardown=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    *) echo "provision-verify-worktree: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "${worktree}" ] || { echo "provision-verify-worktree: --worktree is required" >&2; exit 2; }
# provision mode requires the worktree dir to exist; teardown mode does NOT (the leak's exact shape is
# "dir already deleted, sessions still alive" — teardown must reclaim those).
if [ "${teardown}" -eq 0 ] && [ ! -d "${worktree}" ]; then
  echo "provision-verify-worktree: worktree dir not found: ${worktree}" >&2; exit 2;
fi
[ -d "${root}/node_modules" ] || [ "${teardown}" -eq 1 ] \
  || { echo "provision-verify-worktree: main repo node_modules not found at ${root}/node_modules" >&2; exit 2; }

# ── TEARDOWN MODE (--teardown): 删目录 + 回收进程 — the complete teardown ────────────────────────
if [ "${teardown}" -eq 1 ]; then
  # 1. RECLAIM PROCESSES first (the leak's root cause): stop every claude session whose --settings
  #    path is under this worktree. Runs even when the dir is already gone — the sessions are still
  #    addressable by their --settings workspace path. Best-effort (never fails the teardown).
  if [ -f "${SCRIPT_DIR}/orphan-session-check.ts" ]; then
    if [ "${dry_run}" -eq 1 ]; then
      echo "provision-verify-worktree: [dry-run] would stop claude sessions under ${worktree} (orphan-session-check.ts --kill-workspace)"
    else
      echo "provision-verify-worktree: stopping claude sessions under ${worktree} (teardown reclaim)..."
      node --no-warnings --experimental-strip-types "${SCRIPT_DIR}/orphan-session-check.ts" --kill-workspace "${worktree}" 2>&1 \
        | sed 's/^/provision-verify-worktree:   /' || true
    fi
  else
    echo "provision-verify-worktree: WARNING orphan-session-check.ts not found at ${SCRIPT_DIR}/orphan-session-check.ts — sessions not reclaimed" >&2
  fi
  # 2. DELETE THE DIRECTORY (registration first, then the dir; a registration-only removal leaves
  #    the dir orphaned on disk, a dir-only rm leaves a dangling git registration).
  if [ "${dry_run}" -eq 1 ]; then
    echo "provision-verify-worktree: [dry-run] would git worktree remove --force ${worktree} (if registered) + rm -rf"
  else
    if git -C "${root}" worktree list --porcelain 2>/dev/null | grep -Fq "worktree ${worktree}"; then
      git -C "${root}" worktree remove --force "${worktree}" >/dev/null 2>&1 \
        && echo "provision-verify-worktree: git worktree removed: ${worktree}" \
        || echo "provision-verify-worktree: git worktree remove failed (may already be unregistered); removing dir directly" >&2
    else
      echo "provision-verify-worktree: worktree not registered (or dir already gone); removing dir directly"
    fi
    rm -rf "${worktree}"
    echo "provision-verify-worktree: teardown complete — ${worktree} removed and its claude sessions reclaimed"
  fi
  exit 0
fi

# 1. Declarative copy (config.yml + vendor dist) via the EXISTING worktree-include mechanism
#    (takes the worktree path as a positional arg; derives primary from git worktree list).
WI="${root}/scripts/worktree-include.sh"
if [ -f "${WI}" ]; then
  if [ "${dry_run}" -eq 1 ]; then
    echo "provision-verify-worktree: [dry-run] would run worktree-include.sh ${worktree} (config.yml + vendor dist)"
  else
    echo "provision-verify-worktree: running worktree-include.sh ${worktree} (config.yml + vendor dist)..."
    bash "${WI}" "${worktree}" || { echo "provision-verify-worktree: worktree-include.sh failed" >&2; exit 2; }
  fi
else
  echo "provision-verify-worktree: WARNING worktree-include.sh not found at ${WI} — config.yml/vendor dist not copied" >&2
fi

# 2. node_modules symlink (worktree-include EXPLICITLY excludes node_modules; the fresh worktree
#    needs deps for esbuild/build-dist — the 13:03 ERR_MODULE_NOT_FOUND hit).
if [ -e "${worktree}/node_modules" ] || [ -L "${worktree}/node_modules" ]; then
  echo "provision-verify-worktree: node_modules already present, keeping: ${worktree}/node_modules"
elif [ "${dry_run}" -eq 1 ]; then
  echo "provision-verify-worktree: [dry-run] would link ${root}/node_modules -> ${worktree}/node_modules"
else
  ln -s "${root}/node_modules" "${worktree}/node_modules"
  echo "provision-verify-worktree: linked ${root}/node_modules -> ${worktree}/node_modules"
fi

# 3. Core CLI dist build (manager 2026-08-10 15:0x finding — the 4th gap). `packages/quay/dist/quay.js`
#    is the CORE CLI build product (needs `npm run build --prefix packages/quay`), gitignored and NOT
#    covered by worktree-include.sh's declarative copy (only plugin/vendor/*/dist). A fresh worktree
#    lacks it → the package e2e tests (npm-pack-e2e / install-config-driven-e2e / task-list-root-scope
#    / sea-bundle-plugin-sidecar, ×5) fail on a missing dist (red r235/r236/r247, 3× over 3.5h).
#    inner 11:13 had already reported this verbatim: "suite runner needs to build dist before running
#    npm-pack-e2e". Build runs AFTER the node_modules symlink (build needs deps).
if [ -f "${worktree}/packages/quay/dist/quay.js" ]; then
  echo "provision-verify-worktree: packages/quay/dist/quay.js already present, keeping"
elif [ "${dry_run}" -eq 1 ]; then
  echo "provision-verify-worktree: [dry-run] would build packages/quay/dist via npm run build --prefix packages/quay"
else
  echo "provision-verify-worktree: building packages/quay/dist (npm run build --prefix packages/quay)..."
  (cd "${worktree}/packages/quay" && npm run build >/dev/null 2>&1) \
    || { echo "provision-verify-worktree: packages/quay build failed" >&2; exit 2; }
  [ -f "${worktree}/packages/quay/dist/quay.js" ] \
    || { echo "provision-verify-worktree: build did not produce packages/quay/dist/quay.js" >&2; exit 2; }
  echo "provision-verify-worktree: packages/quay/dist/quay.js built"
fi

exit 0

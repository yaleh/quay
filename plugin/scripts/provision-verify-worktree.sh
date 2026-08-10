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
# Usage:
#   bash plugin/scripts/provision-verify-worktree.sh --worktree <path> [--root <main-repo>]
#
#   --worktree <path>   the verify worktree to provision (REQUIRED)
#   --root <main-repo>  the main checkout (default: auto-derived from this script's location)
#   --dry-run           print what would be done, change nothing
#   --help              usage, exit 0
#
# Exit codes: 0 = provisioned (or already-provisioned, idempotent); 2 = usage/env error.
#
# Idempotent: re-running on an already-provisioned worktree is a no-op (worktree-include re-copies
# overwriting; the node_modules symlink keeps an existing link).

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "provision-verify-worktree.sh — provision a fresh verify worktree to run the full suite (config.yml+vendor dist via worktree-include, plus the node_modules symlink)"
  echo "usage: bash plugin/scripts/provision-verify-worktree.sh --worktree <path> [--root <main-repo>] [--dry-run]"
  exit 0
fi

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_root="$(cd "${SCRIPT_DIR}/../.." && pwd)"

worktree=""
root="${default_root}"
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --worktree) worktree="${2:-}"; shift 2 ;;
    --root) root="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) echo "provision-verify-worktree: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "${worktree}" ] || { echo "provision-verify-worktree: --worktree is required" >&2; exit 2; }
[ -d "${worktree}" ] || { echo "provision-verify-worktree: worktree dir not found: ${worktree}" >&2; exit 2; }
[ -d "${root}/node_modules" ] || { echo "provision-verify-worktree: main repo node_modules not found at ${root}/node_modules" >&2; exit 2; }

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

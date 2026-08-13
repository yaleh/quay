#!/usr/bin/env bash
# dispatch-worktree-setup.sh — make a freshly-created TASK worktree self-verifying.
# (tasks/gap-worktree-node-modules-inconsistent-self-verify: whether a dispatched worktree can
#  self-verify was AGENT-REMEMBERING, not mechanism — the tasklist agent created the node_modules
#  symlink and could self-verify, the tokenwait agent didn't and fell back to the shared checkout,
#  where mutations land. This script is the MECHANISM: every dispatched worktree gets node_modules
#  + config.yml, so `scripts/test.sh` in the worktree never depends on the agent remembering.)
#
# WHAT IT DOES (the enumerated set):
#   1. node_modules — the build phase of scripts/test.sh FAILS CLOSED without esbuild
#      ("Cannot find package esbuild", refusing to test a possibly-stale bundle — that
#      fail-closed is CORRECT and deliberately left untouched). Make node_modules present:
#        a. symlink <main>/node_modules → <worktree>/node_modules when the main checkout has
#           node_modules (zero-copy, shared installed deps — the tasklist precedent);
#        b. FALL BACK to `npm install` INSIDE the worktree when the main checkout has NO
#           node_modules (bare clone).  (AC1: both paths are tested.)
#   2. config.yml — delegates to the EXISTING scripts/worktree-include.sh (declarative
#      .worktreeinclude copy: .quay/config.yml + plugin/vendor dist), the same step
#      provision-verify-worktree.sh composes. A worktree without .quay/config.yml cannot resolve
#      the workspace root (round-5's "Cannot find repo root" crash family).
#
# DELIBERATELY NOT DONE:
#   - No independent `npm install` per worktree when the main has node_modules (copying the
#     shared node_modules is waste — the task body's explicit "不做").
#   - No dist build / --teardown: provision-verify-worktree.sh owns the verify-worktree lifecycle
#     (incl. --teardown process reclaim). This script is the DISPATCH step only; scripts/test.sh's
#     build_dist_once builds dist when node_modules is present.
#
# Idempotent: re-running on a provisioned worktree is a no-op (existing node_modules kept;
# worktree-include re-copies overwriting). Exit 0 = provisioned / already-provisioned;
# 2 = usage/env error (missing worktree arg, missing install product, non-repo worktree).
#
# Usage:
#   bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>] [--dry-run]
#
#   <worktree-path>  the task worktree to provision (REQUIRED, positional first arg)
#   --root <main>    the main checkout (default: git worktree list --porcelain first entry, or
#                    this script's own repo root)
#   --dry-run        print what would be done, change nothing
#   --help           usage, exit 0
#
# Exit codes: 0 = provisioned (or already-provisioned); 2 = usage/env error.
#
# Tests: plugin/test/dispatch-worktree-setup.test.mjs (@test-group governance).

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "dispatch-worktree-setup.sh — make a freshly-created task worktree self-verifying (node_modules symlink-or-install + config.yml via worktree-include.sh)"
  echo "usage: bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>] [--dry-run]"
  exit 0
fi

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

worktree=""
root=""
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) echo "usage: bash plugin/scripts/dispatch-worktree-setup.sh <worktree-path> [--root <main-repo>] [--dry-run]"; exit 0 ;;
    --*) echo "dispatch-worktree-setup: unknown arg: $1" >&2; exit 2 ;;
    *) [ -z "${worktree}" ] && worktree="$1" || { echo "dispatch-worktree-setup: unexpected extra arg: $1" >&2; exit 2; }; shift ;;
  esac
done

[ -n "${worktree}" ] || { echo "dispatch-worktree-setup: worktree path is required" >&2; exit 2; }
[ -d "${worktree}" ] || { echo "dispatch-worktree-setup: worktree dir not found: ${worktree}" >&2; exit 2; }

# ── resolve the main checkout ────────────────────────────────────────────────────────────────
# --root override wins (hermetic tests pass a throwaway main). Otherwise derive from the worktree's
# own git registration: `git worktree list --porcelain` lists the MAIN worktree FIRST (guaranteed),
# and a task worktree's .git file points at the shared gitdir, so this works from any cwd. Fall
# back to this script's own repo root (SCRIPT_DIR/../..) when the worktree is not a registered git
# worktree (plain-dir fixtures).
if [ -z "${root}" ]; then
  root="$(git -C "${worktree}" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
fi
[ -n "${root}" ] || root="$(cd "${SCRIPT_DIR}/../.." && pwd)"
[ -d "${root}" ] || { echo "dispatch-worktree-setup: main repo dir not found: ${root}" >&2; exit 2; }

# ── 1. node_modules (AC1: symlink path AND install path) ─────────────────────────────────────
if [ -e "${worktree}/node_modules" ] || [ -L "${worktree}/node_modules" ]; then
  echo "dispatch-worktree-setup: node_modules already present, keeping: ${worktree}/node_modules"
elif [ -d "${root}/node_modules" ]; then
  # Symlink path: main has node_modules → zero-copy shared-deps link (the tasklist precedent).
  if [ "${dry_run}" -eq 1 ]; then
    echo "dispatch-worktree-setup: [dry-run] would link ${root}/node_modules -> ${worktree}/node_modules"
  else
    ln -s "${root}/node_modules" "${worktree}/node_modules"
    echo "dispatch-worktree-setup: linked ${root}/node_modules -> ${worktree}/node_modules"
  fi
else
  # Install path: main has NO node_modules (bare clone) → npm install INSIDE the worktree.
  if [ "${dry_run}" -eq 1 ]; then
    echo "dispatch-worktree-setup: [dry-run] would npm install in ${worktree} (main has no node_modules)"
  else
    echo "dispatch-worktree-setup: main ${root} has no node_modules — npm install in ${worktree}..."
    (cd "${worktree}" && npm install) || { echo "dispatch-worktree-setup: npm install failed" >&2; exit 2; }
    [ -d "${worktree}/node_modules" ] \
      || { echo "dispatch-worktree-setup: npm install did not produce ${worktree}/node_modules" >&2; exit 2; }
    echo "dispatch-worktree-setup: npm install done — ${worktree}/node_modules"
  fi
fi

# ── 2. config.yml (delegated to the EXISTING declarative worktree-include.sh) ─────────────────
WI="${root}/scripts/worktree-include.sh"
if [ -f "${WI}" ]; then
  if [ "${dry_run}" -eq 1 ]; then
    echo "dispatch-worktree-setup: [dry-run] would run worktree-include.sh ${worktree} (config.yml + vendor dist)"
  else
    bash "${WI}" "${worktree}" || { echo "dispatch-worktree-setup: worktree-include.sh failed" >&2; exit 2; }
  fi
else
  echo "dispatch-worktree-setup: WARNING worktree-include.sh not found at ${WI} — config.yml/vendor dist not copied" >&2
fi

exit 0

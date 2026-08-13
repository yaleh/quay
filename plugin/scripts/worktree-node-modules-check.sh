#!/usr/bin/env bash
# worktree-node-modules-check.sh — scan dispatched TASK worktrees for node_modules readiness.
# (tasks/gap-worktree-node-modules-inconsistent-self-verify AC4: the self-verification consistency
#  of a dispatched worktree is mechanism, not agent memory — this checker makes the INVARIANT
#  observable: every dispatched worktree (branch `task/*`) must have node_modules present, or its
#  `scripts/test.sh` build phase fails closed and verification silently falls back to the shared
#  checkout where mutations land.)
#
# WHAT IT SCANS:
#   For each registered worktree whose branch matches `task/*` (a DISPATCHED task worktree),
#   report node_modules readiness:
#     OK        — node_modules present as a symlink → <target> (the shared-deps link)
#     OK        — node_modules present as a real directory (the npm-install fallback)
#     MISSING   — no node_modules (self-verification will fail at the build phase)
#   Verify/iteration worktrees (provisioned by provision-verify-worktree.sh / milestone-worktree)
#   are NOT scanned — they are provisioned by a different, already-wired step.
#
# EXIT / POSITIONING (AC4 "fail-closed 或不阻断取决于定位"):
#   Default = REPORT-ONLY (exit 0 even when a task worktree is MISSING) — a worktree mid-setup is a
#   transient state, and this checker is wired into run_static_checks (full-suite gate), where a
#   hard-fail on a peer task's mid-provision worktree would make the suite red for the wrong reason.
#   `--fail` flips it to FAIL-CLOSED (exit 1 on any MISSING) — the explicit "block the round" form
#   for the moment a human wants the invariant enforced hard.
#
# Usage:
#   bash plugin/scripts/worktree-node-modules-check.sh [--root <repo>] [--fail] [--json] [--dry-run]
#
#   --root <repo>  repo root (default: derived from this script's location)
#   --fail         fail-closed: exit 1 when any task worktree is MISSING node_modules
#   --json         machine-readable JSON array (hermetic tests)
#   --dry-run      alias of --json (no writes anywhere — this checker is read-only either way)
#   --help         usage, exit 0
#
# Exit codes: 0 = clean (or report-only with MISSING found); 1 = --fail and any MISSING; 2 = usage/env.

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "worktree-node-modules-check.sh — scan dispatched task worktrees for node_modules readiness (report-only by default; --fail fail-closed)"
  echo "usage: bash plugin/scripts/worktree-node-modules-check.sh [--root <repo>] [--fail] [--json]"
  exit 0
fi

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-}"
fail=0
json=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:-}"; shift 2 ;;
    --fail) fail=1; shift ;;
    --json|--dry-run) json=1; shift ;;
    *) echo "worktree-node-modules-check: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "${ROOT}" ] || ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
[ -d "${ROOT}" ] || { echo "worktree-node-modules-check: repo root not found: ${ROOT}" >&2; exit 2; }

# Enumerate registered worktrees. A task worktree's .git is a FILE pointing at the shared gitdir;
# `git worktree list` from the main checkout lists them all. Not a git repo → usage/env error (2).
if ! wt_list="$(git -C "${ROOT}" worktree list --porcelain 2>/dev/null)"; then
  echo "worktree-node-modules-check: not a git worktree: ${ROOT}" >&2; exit 2
fi

rows=()
missing=0
total=0
last_path=""
while IFS= read -r line; do
  case "$line" in
    worktree\ *)
      last_path="${line#worktree }"
      ;;
    branch\ *)
      b="${line#branch refs/heads/}"
      case "$b" in
        task/*)
          total=$((total + 1))
          # ready (symlink or real dir — either makes the build phase self-verifying)
          if [ -L "${last_path}/node_modules" ]; then
            target="$(readlink "${last_path}/node_modules" 2>/dev/null || true)"
            state="OK symlink -> ${target}"
          elif [ -d "${last_path}/node_modules" ]; then
            state="OK dir"
          else
            state="MISSING"
            missing=$((missing + 1))
          fi
          rows+=("${state}|${last_path}|${b}")
          if [ "${json}" -eq 0 ]; then
            echo "worktree-node-modules-check: ${state}  ${last_path}  (${b})"
          fi
          ;;
      esac
      ;;
  esac
done <<<"${wt_list}"

if [ "${json}" -eq 1 ]; then
  # `--json`: stdout is EXACTLY the machine-readable array (no human lines mixed in).
  out="["
  sep=""
  for row in "${rows[@]}"; do
    state="${row%%|*}"
    rest="${row#*|}"
    path="${rest%%|*}"
    branch="${rest#*|}"
    out="${out}${sep}{\"worktree\":\"${path}\",\"branch\":\"${branch}\",\"node_modules\":\"${state}\"}"
    sep=","
  done
  out="${out}]"
  echo "${out}"
else
  if [ "${total}" -eq 0 ]; then
    echo "worktree-node-modules-check: 0 task worktrees registered (nothing to scan)"
  else
    echo "worktree-node-modules-check: ${total} task worktrees checked, ${missing} MISSING node_modules"
  fi
fi
if [ "${missing}" -gt 0 ]; then
  echo "worktree-node-modules-check: MISSING node_modules — self-verification will fail at the build phase; run bash plugin/scripts/dispatch-worktree-setup.sh <worktree>" >&2
  if [ "${fail}" -eq 1 ]; then
    echo "worktree-node-modules-check: --fail set — exiting 1" >&2
    exit 1
  fi
fi

exit 0

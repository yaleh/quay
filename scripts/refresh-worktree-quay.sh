#!/usr/bin/env bash
# refresh-worktree-quay.sh — copy the MAIN checkout's current `.quay/` (config/gates/runtime
# carriers) into a linked WORKTREE's `.quay/` as a snapshot, so a full suite running IN the
# worktree (`cd ${worktree} && bash scripts/test.sh`) reads the SAME gitignored .quay/ data as a
# main-checkout run.
#
# WHY THIS EXISTS (gap-fan-in-worktree-quay-provisioning):
#   `.quay/` is gitignored ⇒ `git worktree add` copies NONE of it. The fan-in full suite runs
#   DIRECTLY in the task worktree (`cd ${worktree} && bash scripts/test.sh` — no
#   full-suite-runner provisioning step), so `<worktree>/.quay/config.yml` was absent or stale ⇒
#   the suite's repo-root resolution (`_findRepoRoot` walks up to `<worktree>/.quay/config.yml`)
#   plus the config/gates tests (M63 ts-typecheck, blocked-signal, cap-from-gate, monitor-mount,
#   run-identity — ruled-gap fan-in: 72 environmental REDs across 22 gate/telemetry/resource test
#   files, ALL green on the main checkout) failed environmentally. This is the OTHER half of
#   gap-gitignored-carriers: the carriers fix (QUAY_MAIN_CHECKOUT, full-suite-runner.ts) pointed
#   CHECKERS at the main checkout; this fixes the SUITE reading the worktree's OWN stale/absent
#   .quay/.
#
# SEMANTICS (each mechanically enforced):
#   - Snapshot, NOT symlink: the worktree suite may WRITE its own .quay/ (checker-cost.jsonl,
#     gate-events via tmp, state files) — writes land in the worktree's copy, never the main.
#   - Copies every gitignored `.quay/*` path from the main checkout (enumerated via git itself, so
#     a NEW carrier is picked up automatically), EXCEPT the heavy/wasteful parts:
#       .quay/node-compile-cache/   — 3.2G; test.sh points NODE_COMPILE_CACHE at its own copy
#       .quay/full-suite-<ISO>.log  — dated per-run logs (historical, ~1.2M each)
#       .quay/manager-inbox/        — message-state dirs (machine-local coordination, irrelevant
#       .quay/outer-inbox/            to a suite run; gitignored per-file)
#   - Idempotent (cp -p overwrites stale copies). No-op on a main-checkout run (the guard below
#     detects the worktree IS the main).
#   - Config source = --root, else QUAY_MAIN_CHECKOUT (full-suite-runner's one-shot sets it), else
#     the git-derived main worktree (fan-in direct path — git rev-parse --git-common-dir: the parent
#     of the shared .git dir; ORDER-INDEPENDENT, not the first `git worktree list` entry).
#
# Usage:
#   bash plugin/scripts/refresh-worktree-quay.sh <worktree> [--root <main-repo>] [--dry-run]
#
# Exit codes: 0 = refreshed (or no-op); 2 = usage/env error.

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "refresh-worktree-quay.sh — snapshot the main checkout's .quay/ (config/gates/runtime carriers) into a linked worktree so the full suite running there reads the same data as a main run"
  echo "usage: bash plugin/scripts/refresh-worktree-quay.sh <worktree> [--root <main-repo>] [--dry-run]"
  exit 0
fi

set -uo pipefail

worktree=""
root="${QUAY_MAIN_CHECKOUT:-}"
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) [ -n "${worktree}" ] && { echo "refresh-worktree-quay: unexpected arg: $1" >&2; exit 2; }
       worktree="${1}"; shift ;;
  esac
done

[ -n "${worktree}" ] || { echo "refresh-worktree-quay: <worktree> is required" >&2; exit 2; }
[ -d "${worktree}" ] || { echo "refresh-worktree-quay: worktree dir not found: ${worktree}" >&2; exit 2; }

# Resolve the main checkout: --root / QUAY_MAIN_CHECKOUT / git-derived.
# The git-derived form is ORDER-INDEPENDENT: the main checkout is the parent of the repo's shared
# `.git` dir (`git rev-parse --git-common-dir`), NOT the first `git worktree list` entry — the list
# order is not guaranteed to place the main working tree first (a linked/detached worktree can be
# listed before it). gap-refresh-worktree-quay-main-derive.
if [ -z "${root}" ]; then
  # git >= 2.31: --path-format=absolute gives an absolute common-dir; older git returns a path
  # relative to ${worktree}, which we resolve against it.
  _common_dir="$(git -C "${worktree}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  if [ -z "${_common_dir}" ]; then
    _common_dir="$(git -C "${worktree}" rev-parse --git-common-dir 2>/dev/null)"
    case "${_common_dir}" in
      /*) ;;
      *) [ -n "${_common_dir}" ] && _common_dir="${worktree}/${_common_dir}" ;;
    esac
  fi
  if [ -n "${_common_dir}" ]; then
    root="$(cd "$(dirname "${_common_dir}")" 2>/dev/null && pwd -P)"
  fi
fi
[ -n "${root}" ] || { echo "refresh-worktree-quay: cannot resolve main checkout for ${worktree}" >&2; exit 2; }

# Linked-worktree guard: when the worktree IS the main checkout, there is nothing to refresh
# (a main-checkout run already reads its own live .quay/).
if [ "$(cd "${worktree}" && pwd -P)" = "$(cd "${root}" && pwd -P)" ]; then
  echo "refresh-worktree-quay: ${worktree} is the main checkout — no-op" >&2
  exit 0
fi
[ -d "${root}/.quay" ] || { echo "refresh-worktree-quay: main checkout has no .quay/ (${root}) — nothing to refresh" >&2; exit 0; }

if [ "${dry_run}" -eq 1 ]; then
  echo "refresh-worktree-quay: [dry-run] would copy ${root}/.quay -> ${worktree}/.quay (config + runtime carriers; skip node-compile-cache / dated full-suite logs / inboxes)" >&2
  exit 0
fi

mkdir -p "${worktree}/.quay"
copied=0
skipped=0
# Exclude node-compile-cache at the PATHS PEC level, not just in the per-path case below: a bash
# loop over 346K+ enumerated ignored files (node-compile-cache is 3.2G) cost ~23s per invocation —
# and scripts/test.sh runs this on EVERY invocation, so the serial-phase grouping tests' nested
# --list-files/--list-groups probes each paid 23s, widening a transient zz-unknown-group fixture
# window into a near-certain false red (gap-fan-in-worktree-quay-provisioning fan-in, 2026-08-15).
# The pathspec exclude drops the enumeration to ~269 paths (~0.3s) while the per-path case below
# stays as defense-in-depth for anything that slips through (a new heavy dir, or git without
# pathspec-magic support — then node-compile-cache is still case-skipped, just slower).
while IFS= read -r rel; do
  # Skip the heavy/wasteful parts (see header). Pattern matched per-path so a new carrier under
  # .quay/ is copied automatically; only these are deliberately excluded.
  case "$rel" in
    .quay/node-compile-cache/*|.quay/full-suite-*.log|.quay/manager-inbox/*|.quay/outer-inbox/*)
      skipped=$((skipped + 1)); continue ;;
  esac
  mkdir -p "${worktree}/$(dirname "${rel}")"
  cp -p "${root}/${rel}" "${worktree}/${rel}" && copied=$((copied + 1)) || true
done < <(git -C "${root}" ls-files --others --ignored --exclude-standard -- .quay/ ':(exclude).quay/node-compile-cache/**' 2>/dev/null)

echo "refresh-worktree-quay: copied ${copied} file(s) (${skipped} heavy/wasteful skipped) from ${root}/.quay into ${worktree}/.quay" >&2
exit 0

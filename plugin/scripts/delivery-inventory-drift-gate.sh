#!/usr/bin/env bash
# delivery-inventory-drift-gate.sh — file-set change gate for the delivery-inventory snapshot
# (tasks/gap-delivery-inventory-drift-needs-file-add-gate).
#
# Question this check makes askable: "Did this change ADD or DELETE a file under plugin/scripts/
# WITHOUT updating the outline §6 DELIVERY-INVENTORY snapshot in the same change?"
#
# Why it exists: verify-delivery-surface.test.mjs went red 6 times on 2026-08-10
# (r216/r222/r223/r226/r248/r253 = 128.4min of suite time), every time the SAME root cause — a
# plugin/scripts/ addition that left docs/proposals/quay-product-outline.md's DELIVERY-INVENTORY
# snapshot stale. 7d2faf06 fixed the SYMPTOM (regenerated the numbers once); nothing owned the
# mechanism "who guarantees the next script-add regenerates the snapshot". This gate IS that owner:
# it is installed ON the add-script action (wired into run_static_checks as a change-relevant
# checker), so the same change set that adds/deletes a plugin/scripts file MUST also touch the
# outline §6 snapshot.
#
# Mechanism (candidate B from the task — the manager-preferred, fewer-false-positive option):
#   ONLY when the change set ADD/DELETEs a file under plugin/scripts/ (`git --diff-filter=AD`, plus
#   the working-tree staged/unstaged/untracked equivalents) does it require the same change set to
#   touch docs/proposals/quay-product-outline.md. Content-only edits to EXISTING scripts (no A/D)
#   do NOT trigger (invariant content_only_change_skipped = 1). FAIL-closed: script A/D without an
#   outline update exits 1.
#
# Change set = committed A/D since a base ref (`--base`, auto-detected as the merge-base with the
# branch this one forked from) UNION the working-tree changes (staged + unstaged + untracked). So
# the gate bites BOTH before commit (the scoped `--for-task` test in the task worktree, where a new
# script is still untracked) AND after (full-suite / CI on the committed branch).
#
# The outline must be TOUCHED (any status), not necessarily consistent — consistency is verified by
# `verify-delivery-surface.ts --inventory` (the AC1/AC2 drift check). This gate is the owner that
# FORCES the update to happen in the same change as the script (AC4: `--write-inventory` gets a real
# non-test caller).
#
# Run:
#   bash plugin/scripts/delivery-inventory-drift-gate.sh [--root <dir>] [--base <ref>] [--list-changes]
# Exit codes: 0 = no plugin/scripts A/D in the change set, OR the outline was updated in it;
#             1 = plugin/scripts A/D present but the outline was NOT updated (FAIL-closed);
#             2 = usage/environment error.
# ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  _gap_help_lib="$(dirname "${BASH_SOURCE[0]}")/gate-script-lib.sh"
  if [ -f "$_gap_help_lib" ]; then . "$_gap_help_lib"; tool_help "$0"; else echo "用法: bash $(basename "$0") [参数…]"; fi
  exit 0
fi
set -u

root=""
base=""
list_changes=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="${2:-}"; shift 2 ;;
    --base) base="${2:-}"; shift 2 ;;
    --list-changes) list_changes=1; shift ;;
    -*) echo "delivery-inventory-drift-gate: unknown argument: $1" >&2; exit 2 ;;
    *) echo "delivery-inventory-drift-gate: unexpected positional argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "${root}" ]; then
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
if ! cd "${root}" 2>/dev/null; then
  echo "delivery-inventory-drift-gate: cannot enter root: ${root}" >&2
  exit 2
fi

# Not a git worktree → fail-open (there is no change set to evaluate).
if [ ! -e .git ]; then
  echo "delivery-inventory-drift-gate: not a git worktree at ${root} — no change set to evaluate (skip)"
  exit 0
fi

# ── auto-detect base ref (the branch this one forked from; falls back to HEAD~1) ────────────────────
if [ -z "${base}" ]; then
  for ref in develop master integration "@{u}"; do
    if git rev-parse --verify --quiet "${ref}" >/dev/null 2>&1; then
      mb="$(git merge-base HEAD "${ref}" 2>/dev/null || true)"
      if [ -n "${mb}" ]; then base="${mb}"; else base="${ref}"; fi
      break
    fi
  done
  [ -n "${base}" ] || base="HEAD~1"
fi

script_structural=0
outline_touched=0

# classify_path <status> <repo-relative-path>
#   marks the gate's two flags from one changed path. Structural (candidate B) = A/D/untracked
#   under plugin/scripts/; R (rename within the bundle) leaves the directory count unchanged and is
#   therefore NOT structural. M/T are content-only and never structural.
classify_path() {
  local st="$1" p="$2"
  case "${p}" in
    docs/proposals/quay-product-outline.md)
      outline_touched=1
      ;;
    plugin/scripts/*)
      local clean
      clean="${st// /}"
      case "${clean}" in
        \?\?) script_structural=1 ;;            # untracked = addition
        *A*|*D*)                                 # added / deleted (staged or unstaged)
          case "${clean}" in
            *R*) : ;;                            # rename — count unchanged, not structural
            *) script_structural=1 ;;
          esac
          ;;
      esac
      ;;
  esac
}

# committed range since base (post-commit / full-suite / CI). NO --diff-filter here: classify_path
# is status-aware (plugin/scripts A/D ⇒ structural; outline touch via ANY status ⇒ satisfied), so an
# outline that was MODIFIED (not just added/deleted) in the same range must count as touched.
while IFS=$'\t' read -r st p; do
  [ -n "${p:-}" ] || continue
  classify_path "${st}" "${p}"
done < <(git diff --name-status "${base}..HEAD" 2>/dev/null || true)

# working tree (pre-commit / scoped): staged + unstaged + untracked
while IFS= read -r line; do
  [ -n "${line:-}" ] || continue
  st="${line:0:2}"
  p="${line:3}"
  classify_path "${st}" "${p}"
done < <(git status --porcelain 2>/dev/null || true)

if [ "${list_changes}" = "1" ]; then
  echo "delivery-inventory-drift-gate: root=${root} base=${base} script_structural=${script_structural} outline_touched=${outline_touched}"
fi

if [ "${script_structural}" -eq 1 ] && [ "${outline_touched}" -eq 0 ]; then
  echo "FAIL: plugin/scripts/ has an ADDED/DELETED file in this change, but docs/proposals/quay-product-outline.md §6 DELIVERY-INVENTORY snapshot was NOT updated in the same change." >&2
  echo "  Regenerate the snapshot: node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --write-inventory" >&2
  exit 1
fi
echo "PASS: delivery-inventory drift gate (plugin/scripts A/D without outline update: no)"
exit 0

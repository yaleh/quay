#!/usr/bin/env bash
# delivery-inventory-drift-gate.sh — file-set change gate for the plugin/workflows mirror
# (gap-drift-gate-covers-only-plugin-scripts-not-workflows).
#
# Question this check makes askable: "Did this change ADD or DELETE a file under .claude/workflows/
# WITHOUT mirroring it into plugin/workflows/ in the same change?"
#
# RETIRED TRIGGER (gap-delivery-inventory-check-time-computation, 2026-08-29): the ORIGINAL trigger
# — "plugin/scripts/ A/D WITHOUT updating the outline §6 DELIVERY-INVENTORY snapshot in the same
# change" (gap-delivery-inventory-drift-needs-file-add-gate, the 2026-08-10 red family) — is
# RETIRED. The outline §6 committed snapshot (scripts=N · gate-scripts=N · …) was removed: the
# delivery inventory is now COMPUTED AT CHECK TIME by `verify-delivery-surface.ts --inventory`, so
# there is no snapshot for a script A/D to co-touch. The workflow-mirror trigger below is
# INDEPENDENT of the snapshot and remains in force.
#
# Mechanism: ONLY when the change set ADD/DELETEs a file under .claude/workflows/ (`git
# --diff-filter=AD`, plus the working-tree staged/unstaged/untracked equivalents) does it require the
# same change set to touch `plugin/workflows/` (the mirror — the plugin distribution copies every
# surviving workflow byte-identically; see plugin/test/plugin-packaging.test.mjs M143 and
# plugin/scripts/workflow-metadata-conformance.mjs Check 8). Content-only edits to an EXISTING
# workflow (no A/D) do NOT trigger (invariant content_only_change_skipped = 1). FAIL-closed:
# workflow A/D without a plugin/workflows/ mirror touch exits 1. The mirror touch is the same-change
# OWNER — byte identity of the mirror is separately verified by M143/AC9/C6 at full-suite time.
#
# Change set = committed A/D since a base ref (`--base`, auto-detected as the merge-base with the
# branch this one forked from) UNION the working-tree changes (staged + unstaged + untracked). So
# the gate bites BOTH before commit (the scoped `--for-task` test in the task worktree, where a new
# workflow is still untracked) AND after (full-suite / CI on the committed branch).
#
# Run:
#   bash plugin/scripts/delivery-inventory-drift-gate.sh [--root <dir>] [--base <ref>] [--list-changes]
# Exit codes: 0 = no .claude/workflows A/D in the change set, OR the plugin/workflows/ mirror was
#             updated in the same change;
#             1 = a .claude/workflows A/D is present but its mirror was NOT updated (FAIL-closed);
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

workflows_structural=0
workflows_mirror_touched=0

# classify_path <status> <repo-relative-path>
#   marks the gate's flags from one changed path. Structural = A/D/untracked under .claude/workflows/;
#   R (rename within the bundle) leaves the mirror count unchanged and is therefore NOT structural.
#   M/T are content-only and never structural. plugin/workflows/ is the MIRROR (co-touch) side: any
#   status there counts as the mirror being updated in the same change set (byte identity is
#   M143/AC9/C6's job at full-suite time).
classify_path() {
  local st="$1" p="$2"
  case "${p}" in
    plugin/workflows/*)
      workflows_mirror_touched=1
      ;;
    .claude/workflows/*)
      local clean
      clean="${st// /}"
      case "${clean}" in
        \?\?) workflows_structural=1 ;;         # untracked = addition
        *A*|*D*)                                 # added / deleted (staged or unstaged)
          case "${clean}" in
            *R*) : ;;                            # rename — mirror count unchanged, not structural
            *)
              # gap-select-preflight-retirement-decision (2026-08-16): a DELETED workflow only
              # requires the plugin/workflows/ mirror touch if the mirror actually existed at base —
              # a legacy workflow that was never mirrored (predates the plugin/workflows/ mirror
              # convention) leaves no stale mirror on deletion, so it is NOT structural. ADDITIONS
              # always require the mirror touch (new_workflow_requires_mirror, FAIL-closed).
              case "${clean}" in
                *A*) workflows_structural=1 ;;
                *)
                  if git cat-file -e "${base}:plugin/workflows/${p#.claude/workflows/}" >/dev/null 2>&1; then
                    workflows_structural=1
                  fi
                  ;;
              esac
              ;;
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
  echo "delivery-inventory-drift-gate: root=${root} base=${base} workflows_structural=${workflows_structural} workflows_mirror_touched=${workflows_mirror_touched}"
fi

if [ "${workflows_structural}" -eq 1 ] && [ "${workflows_mirror_touched}" -eq 0 ]; then
  echo "FAIL: .claude/workflows/ has an ADDED/DELETED file in this change, but plugin/workflows/ (the distribution mirror) was NOT updated in the same change." >&2
  echo "  Mirror the workflow in the SAME change: cp .claude/workflows/<name>.js plugin/workflows/<name>.js (delete the mirror for a removal), then update the surviving-workflow list/count in plugin/scripts/workflow-metadata-conformance.mjs and plugin/test/plugin-packaging.test.mjs." >&2
  exit 1
fi
echo "PASS: delivery-inventory drift gate (.claude/workflows A/D without plugin/workflows mirror: no)"
exit 0

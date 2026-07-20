#!/usr/bin/env bash
# worktree-branch-hygiene-check.sh — DIR-033 (sibling of DIR-031's tree-hygiene-check.sh).
# The outer loop runs two independent iterations per milestone, merges ONE as primary, and today
# leaves the non-primary iteration branch (and every completed milestone's iteration worktrees)
# dangling forever. Two costs: (1) DRIFT — a dangling branch can hold the non-primary iteration's
# REPORT/audit evidence that never reached master (observed: M07 iteration-0's 273-line report was
# orphaned only in exp5-m07-iteration-0); (2) NOISE — dozens of stale worktrees/branches accumulate
# and bury the one dangling branch that actually matters.
#
# This is the mechanical half (ADR-011: a rule ships with its enforcement). It HARD-FAILS on the
# drift-relevant invariant only:
#   No un-merged `exp5-m<N>-iteration-<0|1>` branch may hold a milestone `.md` (report/audit/iteration
#   evidence under experiments/quay-perpetual-stream/milestones/) that is ABSENT from master.
# The fix when it fails: cherry-pick the orphaned report onto master, then delete the branch.
# It ALSO prints the count of prunable merged branches / registered iteration worktrees so ABSORB's
# cleanup step is visible — but that count is informational (cruft, not drift) and never fails the gate.
#
# Exit 0 = no orphaned milestone evidence. Exit 1 = orphaned evidence in an un-merged branch (listed).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT" || { echo "ERROR: cannot cd to repo root ($ROOT)" >&2; exit 1; }

MILESTONE_MD_PREFIX="experiments/quay-perpetual-stream/milestones/"
fail=0
orphans=""

# Match BOTH the legacy `exp5-m<N>-iteration-<0|1>` and the current `m<N>-<slug>-iteration-<0|1>`
# milestone-iteration branch naming (the loop's convention changed at ~M44); excludes human/* etc.
iter_branches() { git branch --format='%(refname:short)' | grep -E '^(exp5-)?m[0-9]+-.*iteration-[01]$'; }

for b in $(iter_branches); do
  # merged into master → its content is on master; dangling worktree/branch is mere cruft, not drift.
  git merge-base --is-ancestor "$b" master 2>/dev/null && continue
  # un-merged: does it carry a milestone .md that master does not have?
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      "${MILESTONE_MD_PREFIX}"*.md)
        if ! git cat-file -e "master:$f" 2>/dev/null; then
          orphans="${orphans}"$'\n'"  ${b} :: ${f}"
          fail=1
        fi ;;
    esac
  done < <(git diff --name-only "master...${b}" 2>/dev/null)
done

# informational: prunable cruft (never affects exit code)
prunable=0
for b in $(iter_branches); do
  git merge-base --is-ancestor "$b" master 2>/dev/null && prunable=$((prunable+1))
done
stale_wt=$(git worktree list | grep -c 'worktrees/iteration' || true)

if [ "$fail" -ne 0 ]; then
  echo "worktree-branch-hygiene: FAIL — un-merged iteration branch(es) hold milestone evidence absent"
  echo "              from master (cherry-pick the report onto master, THEN delete the branch):"
  printf '%s\n' "$orphans"
else
  echo "worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration branches."
fi
echo "info: prunable merged iteration branches=${prunable}; registered iteration worktrees=${stale_wt} (ABSORB should prune these)."
exit "$fail"

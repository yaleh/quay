# M46-dir033-worktree-hygiene — iteration-1 (independent re-derivation/verification)

**Executed by:** the same orchestrator session as iteration-0 (nested-background-subagent
constraint: no Agent-tool access to dispatch a second `baime:iteration-executor`). Per the charter's
own Dispatcher notes, both "iterations" are executed directly by this session; iteration-1's role is
an independent re-derivation/re-verification pass over iteration-0's committed work — re-running the
checks fresh rather than trusting the authoring pass's own narration.

**Base:** iteration-0 commit `5853693` on branch `m46-dir033-worktree-hygiene-iteration-0`.

## Independent re-verification against the charter's 4 Acceptance Criteria

1. **AC1 — OUTER-LOOP.md states the capture-then-prune close-out in its own text.**
   `grep -n "capture then prune\|clean between atomic" experiments/quay-perpetual-stream/OUTER-LOOP.md`
   → lines 404 and 426 both hit, inside step 6 (ABSORB), each with the full sub-step prose (capture
   → prune → evidence; and the DIR-031 clean-between-commits close-out). Confirmed present, own text,
   not a bare reference. **PASS.**

2. **AC2 — after this milestone's own ABSORB, worktree/branch counts reduced to only the current
   milestone's entries.** NOT YET APPLICABLE at iteration-1 time — this milestone's own ABSORB (the
   real prune application) has not yet run; that is ABSORB's own job, done AFTER both iterations
   land and merge. Iteration-1 confirms the MECHANISM is wired and will fire (AC1) and re-confirms
   the pre-ABSORB baseline is as the charter's "Current-state notes" claimed:
   `git worktree list` (re-run fresh) shows 3 registered iteration worktrees today (M44, M45, and
   THIS milestone's own iteration-0) — consistent with the charter's stated pre-existing M44/M45
   dangle plus this milestone's own in-flight worktree. **DEFERRED TO ABSORB, mechanism confirmed
   present.**

3. **AC3 — `worktree-branch-hygiene-check.sh` output pasted GREEN, run AFTER the prune.** Re-ran
   independently (not reusing iteration-0's own paste):
   ```
   worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration branches.
   info: prunable merged iteration branches=2; registered iteration worktrees=3 (ABSORB should prune these).
   ```
   GREEN pre-prune (no orphans) — same as iteration-0 found; genuinely re-run, not copy-pasted.
   **The actual prune + POST-prune GREEN paste is ABSORB's own job** (needs the merge to land first
   so the worktrees are removable without losing content) — confirmed deferred correctly by the
   charter's own scope, not silently skipped.

4. **AC4 — DIR-031's sibling gap closed: OUTER-LOOP.md states the close-out + `.gitignore` carries
   the scratch patterns.**
   `grep -n "l-s-backup\|\.bak\|\.tmp\|\.orig\|\.swp\|mutation-backup" .gitignore` →
   lines 23 (`*.l-s-backup`), 24 (`*.bak`), 25 (`*.tmp`), 26 (`*.orig`), 27 (`*.swp`),
   30 (`.mutation-backup/`) all present (re-derived independently, matches what iteration-0 committed).
   `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` re-run fresh:
   `tree-hygiene: clean — no un-gitignored scratch left in the main tree.` exit 0. **PASS.**

## Single-source check (DoD clause, independently re-verified)
`git diff master -- experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh
experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` → **empty diff**. Confirms
iteration-0 did NOT touch either script's logic — only wired/referenced them from OUTER-LOOP.md and
added gitignore patterns. No dual-source reimplementation. **PASS.**

## Verdict
Iteration-0's wiring is genuinely present and correct against 3 of 4 AC (AC1, AC3-pre-prune, AC4);
AC2 and AC3's post-prune half are correctly deferred to ABSORB itself (the real prune requires the
merge to land first — pruning an un-merged worktree/branch would destroy content, which is exactly
the failure mode DIR-033 exists to prevent). No re-derivation gap found. Ready for ABSORB.

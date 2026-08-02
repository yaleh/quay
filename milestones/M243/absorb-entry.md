# M243 — Absorb Entry

- **Milestone:** M243
- **Task:** DIR-124-A2
- **Charter:** experiments/quay-perpetual-stream/charters/M243-dir-124-a2.md
- **Prepared:** milestones/M243/preparation.json
- **Date:** 2026-08-01
- **Mode:** human-steered

## Surface

- New files: fixtures/workflow-replay/* (10 fixture dirs), scripts/workflow-replay.ts, test/workflow-replay.test.mjs
- Mirrors: plugin/fixtures/, plugin/scripts/, plugin/test/
- No existing files modified

## Gate

### PASS: V_meta consolidation-lag check
PASS — V_meta consolidation-lag check ran from milestones/M243/worktrees/iteration-0 with counter=205 (milestone_counter 206 minus 1). Exit code 0. Both rows checked: [ok] consolidated — lag gate does not apply; [ok] proposed — not past phi threshold, no lag gate. No confirmed-unconsolidated row past K (threshold=2) without a dated carry-forward.

### PASS: Dashboard line budget
PASS: dashboard.md at 1177 lines, under the 1200-line cap. Exit code 0. The dashboard line budget is satisfied — no HARD BLOCK.

Script used: experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh (the experiments copy, which resolves REPO_ROOT correctly in the worktree; the plugin/gate-scripts/ copy overshoots due to the extra nesting of milestones/M243/worktrees/iteration-0/).

### PASS: Tree hygiene
tree-hygiene-check.sh exited 0 from the M243 worktree (milestones/M243/worktrees/iteration-0): "clean — no un-gitignored scratch left in the main tree." No warnings (no untracked ABSORB-pipeline evidence files, no prepare-milestone fixture orphans). The built state in the worktree carries no un-gitignored scratch — gate passes.

### PASS: Worktree branch hygiene
worktree-branch-hygiene-check.sh: PASS (exit 0). No orphaned milestone evidence in un-merged iteration branches. Prunable merged iteration branches=0; registered iteration worktrees=4 (informational — ABSORB should prune these). Ran from M243 worktree at milestones/M243/worktrees/iteration-0 (branch milestone/M243/iteration-0, commit 40a65cf1).

### FAIL: SPLIT-OR-COMMIT (4 CHILD-LINK-SYMMETRY violations)
SPLIT-OR-COMMIT gate FAILED (exit 1) for DIR-124-A2 in the M243 worktree (milestones/M243/worktrees/iteration-0, branch milestone/M243/iteration-0, commit 40a65cf1).

4 CHILD-LINK-SYMMETRY violations (DIR-026):
1. DIR-124-A1a declares parent DIR-124-A1 but DIR-124-A1.children omits it
2. DIR-124-A1b declares parent DIR-124-A1 but DIR-124-A1.children omits it
3. DIR-124-A3a declares parent DIR-124-A3 but DIR-124-A3.children omits it
4. DIR-124-A3b declares parent DIR-124-A3 but DIR-124-A3.children omits it

These are one-way links: the children point up to their parents, but the parents do not list them in their children arrays. This makes parent-done-iff-children silently exclude these orphaned children, allowing parents to be marked done while real child tasks are still open. Fix: add DIR-124-A1a, DIR-124-A1b to DIR-124-A1.children, and DIR-124-A3a, DIR-124-A3b to DIR-124-A3.children in the worktree task files.

### FAIL: build-evidence — build-admission-unavailable
FAIL: build-evidence — build-admission-unavailable — buildAdmissionRef is null and dependency is required by execution policy (not in advisory mode).

Gate ran from worktree at milestones/M243/worktrees/iteration-0 (branch milestone/M243/iteration-0). Manifest milestones/M243/build-evidence-manifest.json exists (128551 bytes) and parsed structurally, but the buildAdmission evidence class has a null ref when the execution policy requires it. This is a HARD BLOCK before Audit.

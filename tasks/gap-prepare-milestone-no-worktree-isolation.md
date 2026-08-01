---
id: gap-prepare-milestone-no-worktree-isolation
title: "prepare-milestone has no per-milestone worktree isolation"
status: todo
labels: [gap, defect, milestone-candidate]
extra: {schema: v1}
---

**type:** execution

## Proposal

Add opt-in `isolationMode: 'worktree'` to prepare-milestone.js, mirroring DIR-123's execute-milestone.js pattern. When present: create worktree before Admission, thread all agent dispatches to worktree path, commit task/plan/receipt in worktree, merge at prepare-merge step.

See Claude Code session analysis (2026-08-01) for full rationale: concurrent prepare-milestone safety, clean rollback on failure, atomic commits, audit trail.

## Finding

M211's staged Build commit was swept by M212's prepare-milestone via broad `git add` on shared working tree — the direct cause of the .halt that paused the loop. prepare-milestone currently edits task bodies, writes plans, and creates receipts directly on the shared tree with no isolation boundary. Two file-disjoint prepare-milestone tasks cannot run concurrently.

## Requested action

1. Add `isolationMode: 'worktree'` parameter (opt-in, default off)
2. Create worktree before Admission, thread path through all agent dispatches
3. Add prepare-merge step: git merge --no-ff after successful prepare
4. Update OUTER-LOOP.md concurrent prepare path
5. Real concurrent proof: two file-disjoint tasks

## Acceptance Criteria

- [ ] Legacy calls (no isolationMode) are byte-for-behavior identical
- [ ] Worktree mode: Build/Audit/Gate produce zero primary-checkout diffs until merge
- [ ] prepare-merge commits task changes + plan + receipt atomically
- [ ] Two concurrent file-disjoint prepare tasks complete successfully
- [ ] Failure cleanup: abandoned worktree + branch on needs-human exits

## Definition of Done

Standard inherited-core DoD clauses apply.

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `CLAUDE.md`

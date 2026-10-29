---
id: gap-goal-branch-unmerged-goal-912
title: "goal-branch-unmerged GOAL-912: merge into develop went red — fix the
  goal branch so it auto-retries"
status: todo
labels:
  - gap
  - goal-branch-unmerged
parent: null
children: []
extra:
  kind: goal-branch-unmerged
  goal: GOAL-912
goal_ac: AC-927
---
## Finding
The branch-mode goal GOAL-912 has a pending merge request into `develop`, and the worker-driver's latest execution went red at step `suite`: full-suite-runner: another runner is already in flight (state=running, pid=2119071) — refusing to start (single-flight; round 131/132 storm). Re-run after it finishes.. The goal branch tip is frozen at `e0ef6034cf3f7a0ac0ff308aaf923e7a929638c9`, so the retry guard (`pendingGoalMerges`, ruling ⑳) will not re-run the merge on its own. Without a task advancing `goal/GOAL-912`, the request deadlocks — no gap task, no fix, no auto-retry.

## Requested action
Fix `goal/GOAL-912` so the merge succeeds (resolve the conflict or make the verification pass), advance the branch to a new tip, and let the worker-driver auto-retry the pending merge (ruling ⑳). Do NOT re-issue the merge request — the existing request stays valid until the branch is merged or the goal leaves `active`.

## AC（draft）
- [ ] `goal/GOAL-912` advances to a new tip and the next worker-driver round auto-runs the merge; the `goal-merge-result` event for GOAL-912 shows `outcome=landed`.

## DoD（draft）
- [ ] The deadlock class is removed: the merge lands without a human re-issuing the request, and no further gap task for this goal is filed.

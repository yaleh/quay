---
id: gap-goal-branch-unmerged-goal-912
title: "goal-branch-unmerged GOAL-912: merge into develop went red — fix the
  goal branch so it auto-retries"
status: ready
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
- [x] `goal/GOAL-912` advances to a new tip and the next worker-driver round auto-runs the merge（本任务把 develop 追平进 goal 分支，fan-in ff 后 tip 前进；`pendingGoalMerges` 已返回 GOAL-912，tip 前进即触发重试）.
- [ ] the `goal-merge-result` event for GOAL-912 shows `outcome=landed`（待外部）.

## DoD（draft）
- [x] No human re-issue and no further gap task for this goal：请求保持有效、重试由 `pendingGoalMerges` 派生；去重键 `kind: goal-branch-unmerged` + GOAL id 命中本任务.
- [ ] The merge lands without a human re-issuing the request（待外部，由 worker-driver 下一轮 goal-merge 步骤复验）.

该轴仍暗,理由:goal 分支追平 develop 的机械合并（tip 前进），无组件代码改动，未跑 archguard/码文档比测量。

## Evidence
- 追平合并：worktree 内 `git merge --no-edit develop`（clean ort merge，无冲突），HEAD merge commit `d125b2966`；goal/GOAL-912 的 tip 将由 `e0ef6034c` 前进到本任务 tip（fan-in ff）。
- 自动重试已武装：`pendingGoalMerges('/data/home/yale/work/quay')` 返回 GOAL-912（tip=e0ef6034c，reqTip=4f8ccf468）——tip 前进后下一轮 worker-driver 自动重跑并入，无需人重发请求。
- `outcome=landed` 为下游读数：suite 红的两条根因（.gitignore blanket 回归 / l1-delivery 测试旧文件位置）由兄弟任务 `gap-goal912-merge-suite-gitignore-blanket-and-l1-test-stale` 修复（其在飞）；本任务只负责前进 tip 并保留请求。

## Touches

- tasks/gap-goal-branch-unmerged-goal-912.md
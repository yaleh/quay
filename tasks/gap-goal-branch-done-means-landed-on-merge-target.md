---
id: gap-goal-branch-done-means-landed-on-merge-target
title: 落到 goal 分支的任务把 done 同时写到 develop——done 的语义改为「已落到它的 mergeTarget」，否则任务被反复派发（B2）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-data-model-and-lifecycle
goal_ac: AC-323
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §5 B2，裁定⑪）：`plugin/scripts/worker-fan-in.ts` 的 `flipTaskDone`（`:1106` 起）在任务 worktree 提交 `status: done`，随 ff 进 mergeTarget；「已落地」读 mergeTarget 上的任务文件（`:1103-1106`、`:1131-1133`）。而派发与晋升读主检出盘上的 `tasks/*.md`，主检出跟随 develop。mergeTarget = goal 分支时，develop 上仍是 ready ⇒ worktree 回收后任务被重新派发。

**修法（已裁定⑪）**：代码照常进 `goal/<id>`；ff goal 分支成功后，经现有文档面写路径（主检出 author 上提交 + `propagateDocBranchToDevelop`）把同一个 done 翻转写到 develop。`done` 的语义改为「已落到它的 mergeTarget」。mergeTarget = develop 时行为逐字不变（不额外写文档面）。

**落地类读者分类**：`grep -rnE '\?\? *["'"'"']develop["'"'"']' plugin/scripts plugin/workflows packages/quay/src`（排除测试）在 2026-10-03 命中 20 处 / 17 个文件（前 3 条：`defect-latency-pair.ts:755`、`anti-drift-touches-check.ts:405`、`quay-init.sh:1927` 注释）。逐条分类：以 develop 判「是否已落地」的读者改为按任务解析 mergeTarget（在 Touches 内的就改）；统计/历史类保持 develop。

## AC

- [ ] 新增 `plugin/test/worker-fan-in.test.mjs`（临时仓库，直接调用机械 fan-in 的落地段）：mergeTarget = `goal/GOAL-901` 时落地后 `git show develop:tasks/<id>.md` 与主检出上的任务文件都是 `status: done`，代码只在 `goal/GOAL-901` 上；mergeTarget = develop 时不产生额外的文档面提交。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] Evidence 中给出上面 grep 的完整分类表（文件:行、类别、处理），命中数与 2026-10-03 的 20 处对账（不同则说明差异）；Touches 外需要改的点逐条写明，留给后续任务。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-done-means-landed-on-merge-target` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：落到 goal 分支的任务此后不再被派发。生产读数由 GOAL-028 的 AC-323（落地后的派发起点数为 0，且该任务自己的派发起点能在 worker-round 载体里读到）在第一个试点 goal 上取得。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/driver-filters.ts
- plugin/test/worker-fan-in.test.mjs
- tasks/gap-goal-branch-done-means-landed-on-merge-target.md

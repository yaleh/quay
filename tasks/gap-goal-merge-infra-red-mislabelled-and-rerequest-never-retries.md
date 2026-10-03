---
id: gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries
title: goal 并入的非冲突失败被标成 merge-conflict，且 tip
  未变时人重发请求也不会被重试——基础设施红之后请求永久卡死（GOAL-904 演练读到）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-worktrees-lack-node-modules
goal_ac: AC-325
---
## Proposal

**机制**（同一次演练读到，`goal-merge-result` 事件与 `packages/quay/src/goal-merge.ts:359-380` `pendingGoalMerges`）：

1. **红的标签说谎**：`runGoalMergeFanIn`（`plugin/scripts/worker-fan-in.ts`）在 `git merge --no-ff` 失败时一律写 `step: "merge-conflict"`。GOAL-904 那次的真因是 pre-merge-commit 钩子因缺依赖崩了（reason 里是 `ERR_MODULE_NOT_FOUND … Not committing merge; use 'git commit' to complete the merge.`），不是内容冲突——读 `step` 的人（和下游 gap-filing）会被误导去找冲突（硬规则 3b：读不懂的失败不得与已知成因同形）。
2. **重发请求不会被重试**：`pendingGoalMerges` 只比较「上次结果的 tip」（`:376` `prev.tipSha === tipSha ⇒ 不重试`），与请求事件无关。并入因**基础设施**原因红了（tip 不会前进去「修复」）之后，人再发一次 `quay goal merge` 记录了新的请求事件，却仍被这一行压住——请求永久卡死，只有 goal 分支前进才能解。裁定⑳ 只说「tip 前进后自动重试」，没有说「人明确再请求也不重试」。

**修法（方向，实现者可调）**：
1. 并入失败按原因分类写入 `step`：内容冲突（`git merge` 退出码 1 且工作树有未合并路径）保持 `merge-conflict`；其它（钩子失败、spawn 失败等）用独立取值（如 `merge-failed`），`reason` 保留原文。
2. 一条**晚于最近一次结果**的请求事件视为人的显式重试：即使 tip 未变也进入待执行。⛔ 不改自动重试规则（tip 没前进且没有新请求 ⇒ 仍不重跑，同一棵树重跑全量 suite 只是在赌偶发）。

## AC

- [ ] `packages/quay/test/goal-merge.test.mjs` 新增用例：构造「有请求 + 最近一次结果为 red + tip 未变」的账本——无新请求时 `pendingGoalMerges` 不含该 goal；其后追加一条时间更晚的请求事件，`pendingGoalMerges` 含该 goal；tip 前进时（无新请求）仍含该 goal（既有规则不变）。
- [ ] `plugin/test/worker-driver.test.mjs` 新增两臂用例（临时仓库）：① 真实内容冲突的并入，结果 `step` 为 `merge-conflict`；② 并入被一个失败的 pre-merge-commit 钩子中止（非冲突），结果 `step` 不是 `merge-conflict`，且 `reason` 含钩子的原始输出。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] `node --test packages/quay/test/goal-merge.test.mjs plugin/test/worker-driver.test.mjs` 退出 0。
- [ ] 5b 邻近扫描：在 `plugin/scripts/worker-fan-in.ts` 内 grep 其它把多种失败折成同一个 `step` 取值的 `red(` 调用点，把命中数与前 3 条贴进 Evidence，逐条判断是否同样会误标；需要且在 Touches 内的一并改。

## DoD

真实落地判据：落地之后，goal 并入因非冲突原因红时，`goal-merge-result.step` 不再写 `merge-conflict`；人对一个卡在红上的 goal 再发一次 `quay goal merge`，worker-driver 在下一轮重新执行它。生产读数由 GOAL-028 的 AC-325 在 GOAL-904 演练的并入完成后取得（需人对 GOAL-904 再发一次请求）。

## Touches

- plugin/scripts/worker-fan-in.ts
- packages/quay/src/goal-merge.ts
- plugin/test/worker-driver.test.mjs
- packages/quay/test/goal-merge.test.mjs
- tasks/gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries.md

---
id: gap-promotion-uncommitted-flip-poisons-settaskstatus
title: promotion 未提交翻转毒化 setTaskStatus——工作树残留 ready 使后续轮判 not-todo 永不重提交
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`setTaskStatus`（`ready-pool-check.ts:2488-2506`）判 `status: todo` 时**读工作树文件**（`fs.readFileSync(path.join(root, "tasks", ...))`）。若上一轮 `commitTaskStatus`（`:2527`）提交失败（committed=false，被吞），工作树残留未提交的 `ready` ⇒ 后续轮 `setTaskStatus` 读到 `ready` 判 `not-todo` 跳过，`commitTaskStatus` 永不重跑 ⇒ develop 永远 todo。

**实证**：`gap-dashboard-testscard-livecard-auto-refresh` 20:50 翻转 ready 未提交；21:11-21:13 连续 `applied` 记录 `reason: not-todo, committed: false`（工作树 ready、develop todo、HEAD todo、索引空），worker-driver 读 develop 判 pool=0 永不派发，卡 20+ 分钟。已手工补提交解堵（`b190723ae`）。

**根因**：`setTaskStatus` 读工作树而非 develop/git；提交失败静默（committed=false 不重试不落痕），未提交 ready 毒化后续轮（「未提交 promotion 挡 fan-in clean-tree」同族，memory `uncommitted-promotion-blocks-fan-in-clean-tree`）。

## Plan

二选一（或组合）：
1. `setTaskStatus` 判「当前是否 todo」改读 develop ref（`git show develop:tasks/<id>.md` 或 `readTaskStatusAtRef`），工作树未提交 ready 不再毒化——develop 仍是 todo ⇒ 重新翻转并提交。
2. 提交失败时重提交：`commitTaskStatus` 返回 false 时，检测工作树已翻转 ready 但 develop 未跟上 ⇒ 补提交（reconcile），⛔ 不静默吞。

## Acceptance Criteria

- [x] AC1（能取假）：构造「翻转 ready 但提交失败」的脏工作树 ⇒ 下一轮 promotion 判 develop 为 todo 并重新提交（develop 收敛 ready），⛔ 仍判 not-todo 跳过 ⇒ 假。
- [x] AC2（能取假，负控制）：工作树已 commit 的 ready（develop 已 ready）⇒ setTaskStatus 仍判 not-todo 跳过（不重复翻转）；（⛔ 已 ready 仍重翻 ⇒ 假）。

## Definition of Done

`setTaskStatus` 判 todo 读 develop（或提交失败 reconcile 重提交）；AC1/AC2 勾；未提交翻转不再毒化后续轮；全量 suite 绿。

## Touches

- plugin/scripts/ready-pool-check.ts（setTaskStatus 判 todo 读 develop / commit 失败 reconcile）
- plugin/test/ready-pool-check.test.mjs（脏工作树下一轮重提交 + 负控制）
- tasks/gap-promotion-uncommitted-flip-poisons-settaskstatus.md（自身）

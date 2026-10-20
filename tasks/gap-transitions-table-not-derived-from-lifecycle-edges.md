---
id: gap-transitions-table-not-derived-from-lifecycle-edges
title: TRANSITIONS 运行时邻接表从 LIFECYCLE_EDGES 派生——消灭第二份手写转移邻接表（gate/lifecycle.ts
  注释点名的 follow-up）
status: ready
labels:
  - gap
  - lifecycle
parent: null
children: []
extra:
  schema: execution
---
## Proposal

gate/lifecycle.ts 的 TRANSITIONS（promote/retreat 运行时邻接表）+ legalForward/legalBack/assertTransition，与 kernel/task-transition.ts 的 LIFECYCLE_EDGES（5×5 声明边表，from/to/kind/current|legacy）是同一张状态转移图的两份手写表示。gate/lifecycle.ts:105-109 的注释明写这是刻意的中间态（"DECLARATION ONLY … deliberately NOT derived"），并点名 "Wiring the writers … is a FOLLOW-UP task, not this one"。本任务就是那个 follow-up：让运行时邻接表从声明表派生，转移图回到单一真源。

## Plan

1. 读 gate/lifecycle.ts 的 TRANSITIONS + legalForward/legalBack/assertTransition，与 kernel/task-transition.ts 的 LIFECYCLE_EDGES 逐对核对语义等价（含 current vs legacy 的取舍）。
2. 把 TRANSITIONS 改为从 LIFECYCLE_EDGES 派生（按 status 聚合 forward/back），删除手写表；legalForward/legalBack 改读派生结果。
3. 以 packages/quay/test/lifecycle-edge-table.test.mjs 的 25 对 golden 对照作安全网：派生前后输出必须逐字节一致，不因适配派生而放宽任何断言。
4. 跑 scripts/test.sh 相关泳道确认无回归。

## Acceptance Criteria

- [ ] TRANSITIONS 的定义处不再是一份手写邻接表，而是从 LIFECYCLE_EDGES 派生的逻辑（可 grep 验证：gate/lifecycle.ts 里 TRANSITIONS 只出现在派生处，无第二份手写表）。
- [ ] packages/quay/test/lifecycle-edge-table.test.mjs 的 25 对 golden 对照仍全绿，且该 test 文件没有为适配派生而放宽断言。

## Definition of Done

- 两条 AC 全绿；git grep -n TRANSITIONS 显示运行时邻接表只有派生处一处定义。
- 改动经 scripts/test.sh 相关泳道通过，合并进 develop，且 task 状态经 gate 落地为 done。

## Touches

- packages/quay/src/gate/lifecycle.ts
- packages/quay/src/kernel/task-transition.ts
- packages/quay/test/lifecycle-edge-table.test.mjs
- tasks/gap-transitions-table-not-derived-from-lifecycle-edges.md
---
id: gap-ready-pool-depends-on-status-stale-read
title: ready-pool-check 的 depends_on 依赖状态读 stale（依赖已 done 仍报 blocking Y）——statusOf 读 allTasks 磁盘 Map，非 develop
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`ready-pool-check.ts:1648` 的 depends_on 判定 `allDepsDone(deps, (depId) => { const p = allTasks.get(depId); return p ? p.status : null; })` 从 `allTasks` Map 读依赖状态，而 `allTasks` 由 `fs.readdirSync + fs.readFileSync`（:1972-1976）从**主检出 disk** 构建——与 (乙)（`gap-dispatch-reads-stale-main-checkout-task-status`）修的是不同路径：(乙) 改了 task status 读 develop ref（`readTaskStatusAtRef`），但 depends_on 的依赖状态读仍走 disk `allTasks` ⇒ 依赖已 done 仍报 blocking。

**实证 2026-08-30（gap-execution-loop-productization-p2-p4）**：`depends_on: gap-adr034-fan-in-lock-holder-supervised`，gap-adr034 已 done（disk + develop，landed fd4209ef）。直接测 `allDepsDone`（readTaskStatus 读 disk）=true，但 ready-pool-check 报「blocking Y(depends-on 1)」——allTasks 陈旧视图把依赖判未 done。

## Plan

depends_on 的 statusOf 改读 develop ref（复用 `readTaskStatusAtRef(root, "develop", depId)`，ready-pool-check.ts:2004 已有），与 (乙) 的 status 读源统一。⛔ 不改 allTasks 全局构建（它服务多用途），只把 depends_on 这一处 statusOf 换成 ref 读。

## Acceptance Criteria

- [x] AC1（能取假）：依赖在 develop=done、主检出 stale 时，depends_on 判定不再报 blocking（读 develop 判 done）；（⛔ 仍 blocking ⇒ 假）。
- [x] AC2（能取假，回归）：依赖真未 done（develop 非 done）时，depends_on 仍 blocking（fail-closed 不变）。
- [x] AC3（能取假，单测）：ready-pool-check.test.mjs 断言「dep develop=done 主检出 stale → depsSatisfied=true」，改掉任一 ⇒ 红。

## Definition of Done

depends_on statusOf 改读 develop ref；AC1-AC3 全勾；全量 suite 绿；gap-execution-loop 类「依赖已 done 仍 blocking」不再误判。

## Touches

- plugin/scripts/ready-pool-check.ts（depends_on statusOf 改 readTaskStatusAtRef 读 develop）
- plugin/test/ready-pool-check.test.mjs（AC3 单测）
- tasks/gap-ready-pool-depends-on-status-stale-read.md（自身）

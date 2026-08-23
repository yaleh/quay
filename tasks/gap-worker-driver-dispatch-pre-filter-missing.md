---
id: gap-worker-driver-dispatch-pre-filter-missing
title: worker-driver 派发前候选过滤缺失（depends_on 维度；Touches 维度已在 gap-launch-script-worker-cap-broken AC3）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：ac138 白烧一轮（16:02 派 → 16:16 退，14.5min 零提交）的根因分析。

**现象（实测）**：`grep -c depends_on worker-driver.ts` = **0**，`ready-pool-check.ts` = **12**——判定逻辑有依赖感知（`depsReadyFor` 在 ready-pool-check），但**派发环没有**：worker-driver 把 ready-pool-check 给出的 ready 列表直接派发，不二次过滤 `depends_on`。⇒ 依赖未满的任务（如 ac138：代码已 land、依赖链 ac139→liveness 未满、翻 done 会重造 DEP-DONE-IFF-DEPS 违例）仍被派发，worker 起来推一遍「无实现工作可做 + 不能翻 done」后退出，白烧 ~15min 墙钟。

**同源（Touches 维度）**：worker-driver 派发前也不查 Touches 互斥（`gap-launch-script-worker-cap-broken` AC3 正是补这个）。**两者是同一个缺口的两半**：派发前候选过滤缺失（depends_on + Touches）。

## Plan

1. worker-driver 派发前对候选做二次过滤：`depends_on` 未满（依赖链未 done）的任务不进候选。
2. 与 Touches 过滤（AC3）同一处做（同一 spawn 前过滤点，两个维度一并判）。

## Acceptance Criteria

- [x] AC1：依赖未满（`depends_on` 含未 done 任务）的任务不被 worker-driver 派发（⛔ 仍派发 ⇒ 假，如 ac138 白烧一轮再现）。

## Definition of Done

- [x] 派发前 depends_on 过滤落地 + 依赖未满任务不派发；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/worker-driver.ts（派发前 depends_on 过滤，与 Touches 过滤同点）
- plugin/test/worker-driver.test.mjs（test）
- tasks/gap-worker-driver-dispatch-pre-filter-missing.md（自身）

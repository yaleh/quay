---
id: gap-long-term-guarantee-registry-hand-maintained
title: 长期保证登记表手维护 3 项而候选 125 条（120 条无 goal_ac）——PASS 3/3 是按构造的绿
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
goal_ac: AC-190
---
## Proposal

**实测（2026-09-09）**：`plugin/scripts/long-term-guarantee-goal-backed-check.ts` 跑出
`PASS: 全部长期保证均有 goal 层 criterion AC 背书 (3/3)`。而它逐条核的是 `:45` 的
`const REGISTERED_GUARANTEES: readonly string[] = [...]` —— **一张手维护的三项表**。

同时实测：带 `delivery-critical` 标签的任务 **125 条，其中 120 条没有 `goal_ac`（96%）**。
⇒ **手写表覆盖 2.4%，它的绿是按构造的。**

该脚本自己的注释预言过这一点：「第四条、第五条长期保证仍会默认停在 task 层而没有任何红」——
**然后给出的修法是一张手写表**。这与 `CORE_REFERENCED`（手维护两项，漏掉 driver-runtime.ts，
2026-09-08 已改机械推导）是**同一形态，同一周内第二次**。

## Plan

1. **换形态，不修那张表**：把「登记」从事后清单改成**立案时必填**——凡带指定标签
   （`delivery-critical`，或新设的耐久保证标签）的任务，`goal_ac` 必须非空，fail-closed。
   登记表随之退役，检查从「枚举清单」变成**位置判定**（硬规则 2）。
2. **必须划生效线**：120 条存量会让闸一接上就全红并挡住派发 ⇒ 只对**生效时刻之后新立案**的任务生效
   （按 createdAt 或显式 cutoff），存量单独排期，⛔ 不在本任务里清。
3. 退役 `REGISTERED_GUARANTEES`，并把 AC-190 的 criterion 重接到新判据上。

## Acceptance Criteria

- [x] AC1 新立案且带指定标签而 `goal_ac` 为空 ⇒ 闸红（负控制：造一条这样的任务）
- [x] AC2 带标签且 `goal_ac` 非空 ⇒ 闸绿（证明不是恒红）
- [x] AC3 生效线之前的存量任务**不**被判红（打印受影响条数，应为 0）
- [x] AC4 `REGISTERED_GUARANTEES` 字面量在活面 grep 命中 = 0
- [x] AC5 AC-190 的 criterion 指向新判据且可运行
- [x] AC6 `scripts/test.sh` 全量绿

## Definition of Done

AC1–AC6 全绿；且在任务 Evidence 里记下生效线取值与当时的存量条数（125/120），
使「存量为什么没被清」这件事有据可查，而不是变成一个静默豁免。

## Touches

- plugin/scripts/long-term-guarantee-goal-backed-check.ts
- plugin/test/long-term-guarantee-goal-backed-check.test.mjs
- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- goals/AC-190-task-ac.md
- tasks/gap-long-term-guarantee-registry-hand-maintained.md
- plugin/scripts/capability-catalog.sh
- plugin/test/slot-refill.test.mjs

## Evidence

生效线取值：`ACTIVATION_LINE_ISO = "2026-09-09T00:00:00Z"`（`plugin/scripts/long-term-guarantee-goal-backed-check.ts` 常量，显式 cutoff）。

立案时实测存量（本任务 Proposal 原文）：带 `delivery-critical` 标签 125 条，其中 120 条无 `goal_ac`（96%）。
实现时检测器实测（`--json`）：total=120 delivery-critical（标签判读）、grandfathered=120、
其中 grandfathered_no_goal_ac=115、grandfathered_with_goal_ac=5。生效线之前的存量不判红（grandfathered），
单独排期、⛔ 不在本任务清——检测器每轮打印 grandfathered_no_goal_ac 计数，故「存量为什么没被清」有据可查，
是【显式生效线豁免】而非静默豁免。

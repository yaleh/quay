---
id: gap-execution-loop-p4-dispatch-productization
title: P4 残余②③——dispatch 侧产品化（ready-pool-check + slot-refill 单一真相源）
status: needs-human
labels:
  - gap
  - productization
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

从 `gap-execution-loop-productization-p2-p4`（拆条）拆出的 P4 残余②③：`ready-pool-check` 与 `slot-refill` 产品化，派发计算单一真相源。

## Plan

1. ready-pool-check 产品化（派发判定单点）。
2. slot-refill 产品化（派发推荐单点）。
3. 派发计算单一真相源（⛔ 多真相源）。

## Acceptance Criteria

- [ ] AC1（能取假，dispatch 单一真相源）：ready-pool-check/slot-refill 产品化后派发计算单一真相源；（⛔ 多真相源 ⇒ 假）。

## Definition of Done

dispatch 侧产品化落地（ready-pool-check + slot-refill 单一真相源）；AC1 全勾；全量 suite 绿。

## Touches

- plugin/scripts/ready-pool-check.ts（产品化）
- plugin/scripts/slot-refill.ts（产品化）
- tasks/gap-execution-loop-p4-dispatch-productization.md（自身）

## Needs-Human

**执行 2026-08-31T12:41:27.119Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）

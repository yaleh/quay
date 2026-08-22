---
id: gap-ac130-promotion-driver-resident-loop
title: AC130 晋升驱动常驻 + 全池判定循环
status: todo
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

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC130`，⛔ 不在此复制，读那一段）。

**形态**：promotion-driver 常驻运行，每轮调 `ready-pool-check` 取【全池】判定（非单条），跑完一轮不退出、按间隔进入下一轮。

**证据（能取假）**：现状无此进程；`ready-pool-check.ts`（161KB）与 `slot-refill.ts`（89KB）机件已存在可复用。

**为什么 inner 执行**：驱动脚本属产品机件 → inner 域。

## Plan

1. 实现 `promotion-driver.ts`：常驻循环，每轮调 `ready-pool-check` 取全池判定，按间隔进入下一轮。
2. 取假验证：停掉驱动 ⇒ 池中新出现的合格任务不再被晋升。

## Acceptance Criteria

- [ ] AC1：promotion-driver 常驻运行，每轮调 `ready-pool-check` 取全池判定（⛔ 非只看某一条），跑完一轮不退出、按间隔进入下一轮。
- [ ] AC2（能取假）：停掉驱动后池中新出现的合格任务不再被晋升（证明晋升由驱动驱动，非 outer tick）。

## Definition of Done

- [ ] 常驻全池判定循环落地；AC1-2 全勾（含停机取假）；land 到 develop。

## Retires

- 无（本任务新增机制，不退役既有机件）

## Touches

- plugin/scripts/promotion-driver.ts (new)
- plugin/test/promotion-driver.test.mjs (new)
- tasks/gap-ac130-promotion-driver-resident-loop.md（自身）

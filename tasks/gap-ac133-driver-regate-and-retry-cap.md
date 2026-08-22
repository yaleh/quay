---
id: gap-ac133-driver-regate-and-retry-cap
title: AC133 修完由驱动重跑同一个闸验证 + 失败上限 needs-human
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac132-fix-worker-structured-input
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC133`，⛔ 不在此复制，读那一段）。

**形态**：fix worker 退出后，驱动重新调同一个闸（`ready-pool-check`）验证，以闸的新判定为准；⛔ 不信 worker 自述「已修好」。配套失败上限：同一任务连续修 N 次仍不合格 ⇒ 标 `needs-human` 停手。

**依据**：今日 hub-strip 无限 relaunch 占 suite 锁 ~2h（`gap-fan-in-relaunch-retry-cap` 已 land 修 fan-in 侧）——⛔ 不得因 fan-in 侧已修就假定晋升侧免疫（硬规则 5b：修好一处 ≠ 只有那一处）。

## Plan

1. promotion-driver.ts 加重闸验证：fix worker 退出后重新调 `ready-pool-check`，以闸判定为准。
2. 加失败上限：连续修 N 次仍不合格 ⇒ `needs-human` 停手。
3. 取假验证：worker 声称修好但实际未改 ⇒ 仍判不合格；结构上修不好的任务 N 次后停手。

## Acceptance Criteria

- [ ] AC1：fix worker 退出后，驱动重新调 `ready-pool-check` 验证，以闸的新判定为准，⛔ 不信 worker 自述。
- [ ] AC2（能取假）：构造 fix worker 声称修好但实际未改 ⇒ 驱动必须仍判不合格、⛔ 不得晋升。
- [ ] AC3（失败上限，能取假）：同一任务连续修 N 次仍不合格 ⇒ 标 `needs-human` 并停止修复循环；构造结构上修不好的任务 ⇒ 驱动 N 次后停手。

## Definition of Done

- [ ] 重闸验证 + 失败上限落地；AC1-3 全勾（含自述不信 + 上限取假）；land 到 develop。

## Retires

- 无（新增机制）

## Touches

- plugin/scripts/promotion-driver.ts（重闸验证 + 失败上限）
- plugin/test/promotion-driver.test.mjs（自述不信 + 上限取假）
- tasks/gap-ac133-driver-regate-and-retry-cap.md（自身）

---
id: gap-ac135-outer-promotion-retirement
title: AC135 实际切换 + outer A22/A24 退役（单一真相源）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac131-promotion-mechanical-no-llm
  - gap-ac133-driver-regate-and-retry-cap
  - gap-ac134-promotion-outcome-ledger
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC135`，⛔ 不在此复制，读那一段）。

**形态**：晋升面机械化后，outer 执行核中「调 A22 --apply 晋升」与「A24 质量心跳修不合格 todo」两步退役，单一真相源切换到驱动。⛔ 只退 A22 留 A24 = 两个真相源的另一半（A24 正是 AC132/133 要机械化的那一半）。

**为什么必须单列**：AC130–134 只证明「驱动能做」，不证明「outer 已不再做」；两者并存 = 两个真相源（同 AC117 退役清单「`.halt` ⛔ 不得与 MCP halt 并存」同族）。

## Plan

1. 退役 `orchestration/orchestrator-tick-core.md` 中 A22（供给侧心跳晋升）+ A24（质量心跳修 todo）两步（核中不再有，或明标退役并指向驱动）。
2. 同步退役/改 A22 相关检查器（`ac66-a22-agent-id-check.ts` 等，impl 时 grep A22/A24 引用面）。
3. 取假验证：停机（驱动）后晋升照常发生 ⇒ 切换未完成。

## Acceptance Criteria

- [ ] AC1（退役已落）：outer 执行核中「调 A22 --apply 晋升」「A24 质量心跳」两步已退役（核中不再存在，或明标退役指向驱动）。
- [ ] AC2（生产窗口）：自驱动 land 起连续 N 小时窗口内，晋升事件全部由驱动 outcome 记录承担、outer 侧零晋升零修复动作（N 不在此拍板——先无阈值跑分布再定）。
- [ ] AC3（停机取假）：停掉驱动 ⇒ 池中新出现的合格任务不再被晋升（若停驱动后晋升照常 ⇒ outer 仍在做 ⇒ 切换未完成）。

## Definition of Done

- [ ] A22+A24 退役 + 生产窗口证明 + 停机取假；AC1-3 全勾；land 到 develop。

## Retires

- A22（供给侧心跳晋升，`orchestrator-tick-core.md:46`）——它防的缺陷（合格 todo 漏晋）现在由 AC130/131 驱动循环防
- A24（质量心跳修 todo，`orchestrator-tick-core.md:48`）——它防的缺陷（可修小问题饿死派发）现在由 AC132/133 fix worker 防
- 两者在 B13 判定序列中的位置

## Touches

- orchestration/orchestrator-tick-core.md（A22/A24 退役）
- plugin/scripts/ac66-a22-agent-id-check.ts（A22 检查器，退役面同步）
- tasks/gap-ac135-outer-promotion-retirement.md（自身）

> **Touches 扩充说明**：impl 时须 `grep -rn 'A22\|A24'` 全仓库，把其余引用 A22/A24 的检查器（如 `runner-static-gate.ts`、`ready-pool-check.ts` 内对 A22 的引用面）一并纳入 Touches 并同步退役/改。

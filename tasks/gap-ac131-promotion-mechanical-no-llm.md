---
id: gap-ac131-promotion-mechanical-no-llm
title: AC131 合格者纯机械晋升（零 LLM）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac130-promotion-driver-resident-loop
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC131`，⛔ 不在此复制，读那一段）。

**形态**：判定合格的任务由驱动直接调 `A22 --apply` 晋升，该路径上零 LLM 调用。

**证据（能取假）**：A22 现行已是 `ready-pool-check --apply` 纯机械路径（`orchestrator-tick-core.md:46`），本条只是把它从「outer 每轮记得跑」变成「驱动循环的一步」。

**为什么 inner 执行**：驱动脚本（promotion-driver.ts）机械晋升路径 → inner 域。

## Plan

1. promotion-driver.ts 加机械晋升路径：判定合格 → 直接调 `A22 --apply`，零 LLM。
2. 取假验证：构造四件套齐全 deps 空的 todo ⇒ 一轮内晋 ready，outcome 记 `llm_invoked=false`。

## Acceptance Criteria

- [x] AC1：判定合格的任务由驱动直接调 `A22 --apply` 晋升，该路径上不得有任何 LLM 调用。
- [x] AC2（能取假）：构造四件套齐全 deps 空的 todo ⇒ 驱动应在一轮内将其晋为 ready，且该轮 outcome 记录中 `llm_invoked=false`（或等价字段）。

## Definition of Done

- [x] 机械晋升路径零 LLM 落地；AC1-2 全勾（含 llm_invoked=false 取假）；land 到 develop。

## Retires

- 无（新增机制）

## Touches

- plugin/scripts/promotion-driver.ts（机械晋升路径）
- plugin/test/promotion-driver.test.mjs（llm_invoked=false 取假）
- tasks/gap-ac131-promotion-mechanical-no-llm.md（自身）

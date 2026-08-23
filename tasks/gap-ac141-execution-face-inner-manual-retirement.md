---
id: gap-ac141-execution-face-inner-manual-retirement
title: AC141 执行面退役——ready 任务默认 worker-driver 捡，inner 手动介入仅限边界 + 记原因
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac138-worker-driver-production-enablement
---

**type:** execution

## Proposal

**来源**：manager 投立案（AC135 的另一半——执行面）。AC135 只退役了 outer 的手动【晋升】，inner 的手动【实现】这半没有对应退役动作。

**证据（实测）**：驱动上线后，3 个在飞任务里 1 个 worker-driver 真 dispatch、1 个驱动上线前遗留、**1 个是 inner 自己手动 `Agent` 直接实现的（`gap-git-history-vertical-graph-thirdparty-lib`）**。inner 如实承认：默认行为至今仍是手动 dispatch（fast-mode tick 的 A12/A15），从未把「ready 任务默认让 worker-driver 捡」内化进 tick 循环——两条机制并行跑 = AC135「晋升面两个真相源」在执行面的版本。

**规则（inner 提议、manager 认可）**：任务晋 ready 后默认让 worker-driver 捡；inner 只在 ①驱动因故没捡走（超 N 轮未 dispatch）或 ②明确时限压力（人直接裁定「立刻执行」）时才手动介入，且介入时必须记明原因。

## Plan

1. inner tick 循环（`fast-mode-tick-core.md` 的 A12/A15 手动 dispatch）退役默认行为，改为「ready 任务默认等 worker-driver 自主捡」。
2. 手动介入边界：①驱动超 N 轮未 dispatch 或 ②明确时限压力（人裁定「立刻执行」），介入时记明原因。

## Acceptance Criteria

- [ ] AC1（默认 worker-driver 捡）：ready 任务默认由 worker-driver 自主派发，inner 不再默认手动 Agent 实现；取假：驱动存活且能捡时 inner 仍默认手动实现（非①②边界）⇒ 假。
- [ ] AC2（边界 + 记原因）：inner 手动介入仅限 ①驱动超 N 轮未 dispatch 或 ②明确时限压力（人裁定「立刻执行」），且介入时记明原因；取假：手动介入无原因记录、或超出①②边界 ⇒ 假。

## Definition of Done

- [ ] 执行面退役（默认 worker-driver 捡 + 边界条件 + 原因记录）；AC1-2 全勾；land 到 develop。

## Retires

- inner tick 循环手动 dispatch（A12/A15）的默认行为（改为 defer 到 worker-driver）

## Touches

- orchestration/fast-mode-tick-core.md（inner tick core 手动 dispatch 退役面，defer 到 worker-driver）
- tasks/gap-ac141-execution-face-inner-manual-retirement.md（自身）

> **注意**：⛔ 非一刀切禁止手动——②（人裁定「立刻执行」这类紧急场景）是合理边界；本条要的是「默认 defer + 边界外介入记原因」，不是「禁止手动」。

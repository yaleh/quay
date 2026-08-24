---
id: gap-retire-outer-monitors-after-reconciler
title: 协调循环（任务1-4）落地后退役 outer 两个 Monitor（slot-free-trigger /
  suite-state-trigger，从正确性依赖降级为优化后移除）
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`slot-free-trigger.ts` / `suite-state-trigger.ts` 两个 trigger 现在挂在 outer 会话的 Monitor 上（orchestrator-loop-tick.md:274/:293），是正确性依赖。但今日实测其宿主（Monitor = outer 会话）**已被证伪**：tmux server 重置杀 outer ⇒ 静默消失。协调循环（reconciler + 定时器地板，任务 1-4）落地后，「空槽出现」与「套件转红」都由 driver 每趟 pass 现读（ready 池 / suite state），两个 trigger 从正确性依赖降级为优化（SPEC §5.5）。

## Plan

任务 1-4 落地并验证后，退役这两个 trigger 的 Monitor 挂载（从 outer tick 冷启动 4b2 步骤移除），trigger 脚本本身随之地为冗余（保留实现/测试或移除，按当时判断）。

## Acceptance Criteria

- [ ] AC1（能取假，前置满足）：退役动作发生在任务 1-4 落地之后（⛔ 1-4 未全落地即退役 ⇒ 假——会撤掉仍在岗的正确性依赖）。
- [ ] AC2（能取假，等价性）：退役后，构造「空槽出现」与「套件转红」场景，断言协调循环（driver 地板 + 每趟 pass）在 N 秒内接管响应（⛔ 事件无人响应 ⇒ 假）。

## Definition of Done

任务 1-4 落地后，两个 outer Monitor 挂载移除，空槽/套件红场景由 driver 协调循环接管（AC2 复现），正确性无回归。

## Touches

- orchestration/orchestrator-loop-tick.md（4b2 移除两个 Monitor 挂载）
- orchestration/orchestrator-tick-core.md（同步退役引用）
- plugin/scripts/slot-free-trigger.ts + suite-state-trigger.ts（冗余标记/移除）
- tasks/gap-retire-outer-monitors-after-reconciler.md（自身）
---
id: gap-delivery-critical-label-at-promote-not-after-dispatch
title: delivery-critical 标签在派发后才打 ⇒ AC36 排序轴永不被行使（标签应在 todo→ready 晋级时确定 + 判据语义修正）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，guard 任务）**：guard 于 21:21:10 派发（subagent fork），delivery-critical 标签
21:26:17 才打（晚 5min7s）——**标签的作用点在派发前（排序键），打完已在飞 ⇒ 被自己挤出 ranking**
（`touches-overlap-in-flight` 正确排除）。**今天这根轴两次无法测、原因同源**：
今晨 45 标签 0 ready（无候选）/ 现在 1 ready 有标签但在飞（被自己挤出）。
**共同点：打标签发生在它能起作用的那一刻之后。** 这比「没人打标签」严重——即使人人记得打，
只要时机在派发后，轴就永不被行使。**AC36 缺的不是纪律，是时机**——即使每个人都记得打，
只要打的时机仍在派发后，这根轴就永远不被行使。

**第二处缺陷（manager 指出）**：AC36 端到端判据「打了 label 的任务在 `recommended` 里位次严格前移」
与机制语义冲突——**已在飞任务本就不该出现在 `recommended` 里**（被 touches-overlap-in-flight 排除）。
判据与机制的语义对不上，本身就是要修的缺陷。

## Plan（manager 2026-08-12 裁定 ① + ②）

1. **delivery-critical 在 todo→ready 晋级时确定**（promote 闸或 promote 动作含该判定）——标签与 ready 同现，
   派发时排序键在位，轴在【下一次挑选】时被行使。
2. **AC36 判据语义修正**：改为「在 ready 池内比较两条同族任务，delivery-critical 者在 `recommended` 位次严格前移」——
   影响下一次挑选，不要求当前已在飞的那条出现在 recommended。
3. 负控制：重现本次时序——派发后补标签不被误记为 AC36 已触发（建成零触发 ≠ 已达成）。

## AC

- [ ] AC1: delivery-critical 在 promote 时确定（标签与 ready 同现，负控：派发后补标签不改变排序）
- [ ] AC2: AC36 判据改为 ready 池内同族比较（已在飞任务不要求出现在 recommended）
- [ ] AC3: 负控制——派发后补标签不被误记为 AC36 已触发
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控制样例贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/ready-pool-check.ts（promote 闸加 delivery-critical 判定）
- plugin/scripts/slot-refill.ts（排序键消费 delivery-critical）
- plugin/test/（AC36 端到端判据修正的测试）
- tasks/gap-delivery-critical-label-at-promote-not-after-dispatch.md（自身）

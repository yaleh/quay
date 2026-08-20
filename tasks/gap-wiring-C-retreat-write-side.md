---
id: gap-wiring-C-retreat-write-side
title: 接线任务 C（根因④）：retreat 写侧缺失——lifecycle.ts 的 retreat 动作从不写 **RETREATED 标记，端到端从未跑过
status: ready
labels:
  - gap
  - mechanism
  - wiring
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-20 接线审计（8 NOT-WIRED 之一根因④）。Touches 与 A、B 零交集（manager 按交集算过）。

**根因**：`gap-retreated-state-not-mechanized` 的检测侧（`slot-refill.ts`/`ready-pool-check.ts` 读 `**RETREATED` 标记）是真的，但 `lifecycle.ts` 的 retreat 动作路径**从不写这个标记**，任务体自承"靠人手工加"。全仓 **0 个任务文件带该标记**、落地后 **0 次 retreat 事件** ⇒ 端到端从未跑过。

**⛔ Touches 边界**：`packages/quay/src/gate/lifecycle.ts` + `plugin/scripts/slot-refill.ts` + `plugin/scripts/ready-pool-check.ts`。与 A、B 零交集。

## Plan

1. 核实 lifecycle.ts 的 retreat 动作路径（`lifecycle_retreat` / 相关函数）——确认从不写 `**RETREATED` 标记。
2. 接入写侧：retreat 动作发生时写 `**RETREATED` 标记到任务文件（与检测侧读的格式一致）。
3. 生产载体验证：真实 retreat 一次后，任务文件出现标记 + slot-refill/ready-pool-check 检测到（端到端跑通）。

## Acceptance Criteria

- [ ] AC1: lifecycle.ts 的 retreat 动作路径写 `**RETREATED` 标记（与 slot-refill/ready-pool-check 检测侧格式一致）。
- [ ] AC2: 端到端验证——真实 retreat 一次后，任务文件带标记 + 检测侧读到（生产载体，非 fixture）。
- [ ] AC3: 全量 suite 绿。

## Definition of Done

- [ ] retreat 写侧接入（lifecycle.ts 写 **RETREATED 标记，格式与检测侧一致）；端到端生产验证（真实 retreat 一次后标记出现 + slot-refill/ready-pool-check 读到）；全量 suite 绿（scripts/test.sh exit 0）；修复提交可 git log 追溯。

## Touches

- packages/quay/src/gate/lifecycle.ts（retreat 写标记）
- plugin/scripts/slot-refill.ts（检测侧，若需对齐）
- plugin/scripts/ready-pool-check.ts（检测侧，若需对齐）
- tasks/gap-wiring-C-retreat-write-side.md（自身）

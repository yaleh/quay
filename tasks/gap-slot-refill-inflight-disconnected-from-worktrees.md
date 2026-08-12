---
id: gap-slot-refill-inflight-disconnected-from-worktrees
title: slot-refill in_flight=0 而 worktree+telemetry 有在飞任务 ⇒ 仪器不一致
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 实测 + outer 复核）**：`git worktree list` 有 2 个在飞任务 worktree（`gap-suite-state-trigger-retriggers-while-runner-alive` + `gap-verification-round-counter-overwrites-not-sums`），telemetry `inProgress` 同列这 2 条——但 `slot-refill --json` 报 `in_flight_count=0` / `occupied_slots=0`。

**影响**：任何基于 in_flight 的判断全偏——slot-refill 报 `should_refill=true`（5 空槽）而实际 2 槽已占；补派/槽位账/并发闸基于错误读数。

**同类前科**：`gap-inbox-counter-disconnected-from-files`（counter 报 delivered=0 而目录实有 6 封，沉默失败）——「计数器与其源断开，报零而不是报错」同族。

**选定机制**：定位 `slot-refill.ts` 的 in_flight 计数源（读 telemetry `inProgress`？读 worktree？还是别的），修到与 worktree+telemetry 一致；或改读可靠源（telemetry inProgress 是权威——内层每次 --task-start 写）。负控制：无在飞时仍报 0。

**验证锚**：(a) 有在飞 worktree+telemetry ⇒ slot-refill in_flight≥1；(b) 无在飞 ⇒ 0；(c) `--for-task` scoped 门绿。

## Plan

1. 读 `plugin/scripts/slot-refill.ts` 的 in_flight 计数路径，定位它读什么源（telemetry / worktree / 别处）。
2. 对照 telemetry `inProgress`（权威：--task-start 写入）找出差异。
3. 修 + 单测（构造有/无在飞两态）。
4. 回归：slot-refill 既有测试 + `--for-task` scoped。

## AC

- [ ] AC1: 有在飞任务（worktree+telemetry）⇒ slot-refill `in_flight_count` ≥ 实际数
- [ ] AC2: 无在飞 ⇒ 0（负控制不回归）
- [ ] AC3: `should_refill` / `occupied_slots` 与 in_flight 一致（不再报 5 空槽而实际 2 槽被占）
- [ ] AC4: 新测试覆盖 (a)(b)(c)；`--for-task` scoped 门绿
- [ ] AC5: 既有 slot-refill 测试全绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：有在飞 worktree 时 slot-refill in_flight 读数贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

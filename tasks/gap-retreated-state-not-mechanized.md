---
id: gap-retreated-state-not-mechanized
title: "retreated 状态未机制化——slot-refill 推荐刚 retreat 的任务，靠手动跳过（AC53 心跳 REFUSED 根因）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

retreat（load-induced 红、等 fix-scope gate land 前不重派）只靠 TaskStop 释放槽 + 手动跳过，**状态未机制化**——retreat 后任务留 `ready`（可派），slot-refill 推荐它们，而「fix-scope gate land 前不重派」是手动理由未编码。实测 AC53 心跳 REFUSED（should_refill=true + no_refill_reason=null），根因即 3 retreated 任务被 ② 回退后留 ready、slot-refill 推荐而手动跳过。

## Acceptance Criteria

- [ ] AC1: 加「retreated/搁置」状态（label 或 status），slot-refill 不推荐刚 retreat 的任务（直到解除搁置）。
- [ ] AC2: 负控制——retreat 一个任务后，slot-refill 的 recommended 不含它（不靠手动跳过）。
- [ ] AC3: AC53 心跳不再因「retreated 任务可派但手动跳过」REFUSED。

## Definition of Done

- [ ] retreat 一个任务后 slot-refill 不推荐它（真实输出，非手动跳过），解除搁置后恢复可派。

## Touches

- tasks/gap-retreated-state-not-mechanized.md（自身）
- plugin/scripts/slot-refill.ts（retreated 状态排除）
- plugin/scripts/ready-pool-check.ts（retreated 状态识别）
- plugin/test/slot-refill.test.mjs（retreated 排除负控制）

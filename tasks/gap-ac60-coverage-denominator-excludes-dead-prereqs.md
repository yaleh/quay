---
id: gap-ac60-coverage-denominator-excludes-dead-prereqs
title: AC60 通则③·覆盖率分母统一扣除"前提已死"项（防诚实标注反降覆盖率）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC60（通则③·覆盖率分母统一扣除"前提已死"项）判据（phase-goal 逐字）**：
- **判据**：三层的覆盖率记法一致——**"前提已死/来源已冻结"的条目不计入分母**。
- **理由（反向激励，C17 家族）**：**否则诚实标注会让覆盖率下降 ⇒ 激励不标注。** manager 侧已执行（当前扣除 6 条）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 统一三层（outer/inner/manager）的覆盖率分母记法：排除「前提已死/来源已冻结」条目。
2. 验证三层记法一致（含 manager 已执行的 6 条扣除）。
3. 检查器/一致性验证：任一层的分母把已死条目计入 ⇒ 红（负控制）。

## Acceptance Criteria

- [x] AC1 三层覆盖率分母统一排除「前提已死/来源已冻结」条目。
- [x] AC2 三层记法一致（manager 侧 6 条扣除已执行）。
- [x] AC3 负控制：分母把已死条目计入 ⇒ 红。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 三层覆盖率分母统一扣除「前提已死/来源已冻结」条目——outer / inner / manager 记法一致。
- [x] manager 侧 6 条扣除已执行并被一致性验证覆盖（AC2）。
- [x] 负控制接线：任一层的分母把已死条目计入 ⇒ 红；既有测试全绿、`--for-task` scoped 门绿。

## Touches

- orchestration/manager-tick-core.md
- orchestration/orchestrator-tick-core.md
- orchestration/fast-mode-tick-core.md
- plugin/scripts/tick-core-static-check.ts
- plugin/scripts/checker-mutation-cases/tick-core-static-check.sh
- plugin/test/tick-core-static-check.test.mjs
- tasks/gap-ac60-coverage-denominator-excludes-dead-prereqs.md（自身）

## Evidence

**统一记法**：三层执行核共用同一排除标记 `不计入覆盖率分母`。任何标注「前提已死/来源已冻结」
（`DEAD_ANNOT_RE = /前提已死|来源已冻结|已冻结|前提已失效|前提已被人的裁定移除/`）的条目
必须在同一行携带该标记，否则其分母仍计入死条目 ⇒ 红（AC60 判据逐字：三层记法一致）。

**三层落地**（`tick-core-static-check.ts` AC8 读数，`--root .` 实跑）：
- manager：排除 8 / 死 8 —— 含 AC2 要求的 6 条扣除（A7/A12a/A14/B2c/乙/丁）与两条显式修法注记；
- outer：排除 1 / 死 1 —— B4 批量合（integration 分支已删，AC48 退役）；
- inner：排除 1 / 死 1 —— C7（`integration-branch-model.ts` 已 RETIRED，零生产调用者）。

**负控制（AC3，负控制 fixture 实跑样本）**：
```
| A7 | **前提已死** | 不能执行 (src:1) |
```
死条目未标 `不计入覆盖率分母` ⇒ `--only ac8` exit 1，报
`FAIL: orchestration/manager-tick-core.md:4 [前提已死] 死条目未标「不计入覆盖率分母」`。
既有测试全绿（`plugin/test/tick-core-static-check.test.mjs` 17/17 含 3 条 AC8）；scoped 门绿。

**AC4**：`scripts/test.sh --for-task gap-ac60-coverage-denominator-excludes-dead-prereqs --allow-thin` 绿；
`tick-core-static-check.test.mjs` 17/17 pass。

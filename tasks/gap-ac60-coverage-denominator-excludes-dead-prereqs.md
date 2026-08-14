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

- [ ] AC1 三层覆盖率分母统一排除「前提已死/来源已冻结」条目。
- [ ] AC2 三层记法一致（manager 侧 6 条扣除已执行）。
- [ ] AC3 负控制：分母把已死条目计入 ⇒ 红。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 三层覆盖率分母统一扣除「前提已死/来源已冻结」条目——outer / inner / manager 记法一致。
- [ ] manager 侧 6 条扣除已执行并被一致性验证覆盖（AC2）。
- [ ] 负控制接线：任一层的分母把已死条目计入 ⇒ 红；既有测试全绿、`--for-task` scoped 门绿。

## Touches

- （三层覆盖率记法/检查器）
- （负控制 fixture）
- tasks/gap-ac60-coverage-denominator-excludes-dead-prereqs.md（自身）

## Evidence

（落地后回填）

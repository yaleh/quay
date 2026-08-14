---
id: gap-ac56-recommended-deordered
title: AC56 去锚——机制输出不再携带有意义的序（recommended 无序可行集或字典序+标注）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac55-dispatch-record-fingerprint-reason
---

**type:** execution

## Proposal

**AC56（去锚）判据（phase-goal 逐字）**：
- 判据1：`recommended` 改为**无序可行集**，或按**明显无意义的稳定序**（字典序）并**明确标注"序无意义"**。
- 判据2（能取假）：**若输出仍按 `1/cost` 排 ⇒ 检查必须变红。**
- 判据3（防"只改文案"）：**判据必须读【输出本身】，不得只读文档标注**——仅在注释里写"序无意义"而实际仍有序 ⇒ **不算达成**。
- 理由（SPEC §5）：**inner 拿到有序列表会被锚定**，即使它有语义倾向也很难无视"机制推荐的第一个" ⇒ 不去序，新划分就只是名义上的。

**顺序（SPEC §6，不可改）**：本任务**不先于 AC55**（去了序而没有产物 = 把排序权交出去却无法核实它被怎么用了）。

**本任务不新建过程纪律型 AC**：负控制沿用既有 AC49。

## Plan

1. `slot-refill` 的 `recommended` 改为无序可行集，或字典序 + 明确标注「序无意义」。
2. 写检查器**读【输出本身】**（不是读文档标注）：若 `recommended` 仍按 `1/cost` 排（有意义的序）⇒ 红；字典序 + 标注「序无意义」或无序 ⇒ 绿。
3. 负控制：构造一个仍按 `1/cost` 排序的输出样本 ⇒ 必须红（AC49 判据1 归属限定）。

## Acceptance Criteria

- [ ] AC1 `recommended` 无序可行集，或字典序 + 明确标注「序无意义」。
- [ ] AC2 检查器读【输出本身】：仍按 1/cost 排 ⇒ 红；防"只改文案"。
- [ ] AC3 负控制：1/cost 排序样本 ⇒ 红。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] recommended 去序落地 + 检查器读输出本身 + 负控制红。
- [ ] 顺序正确（不先于 AC55）。

## Touches

- plugin/scripts/slot-refill.ts（recommended 去序）
- （检查器 + 负控制 fixture）
- tasks/gap-ac56-recommended-deordered.md（自身）

## Evidence

（落地后回填）

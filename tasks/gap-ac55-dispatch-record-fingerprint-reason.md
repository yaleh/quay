---
id: gap-ac55-dispatch-record-fingerprint-reason
title: AC55 产物·承重条款——inner 派发记录带倾向文件指纹 + 一句为什么选它
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac54-dispatch-preference-file
---

**type:** execution

## Proposal

**AC55（产物·本阶段的承重条款）判据（phase-goal 逐字）**：
- 判据1：每条派发记录含 ①倾向文件的**内容指纹**（git blob hash 或等价，回答"用的是哪一版"）②**一句「为什么选它」**（回答"按倾向选还是随便选"）。
- 判据2（承重理由，C17）：**没有它，「读了没读」在记录上不可区分 ⇒ 只能靠意志 ⇒ 必然失守**——SPEC §4.2 已实证同一形态（manager 的 `A0b⑤(b)` 因"产物之后没人再用"而连续 4 轮被跳过）。
- 判据3（能取假）：拿一条**真实的**派发记录回放，**缺指纹或缺理由时必须报红**。
- **⚠️ 不要求解释每一次「不选」**（SPEC §7 逐字）——只解释**选了什么**，避免产物变成负担而被跳过（§4.2 教训的直接应用）。

**本任务不新建过程纪律型 AC**：负控制沿用既有 AC49。

## Plan

1. inner 的派发流程在派发记录里写入 ①倾向文件内容指纹（git blob hash，来自 AC54 的文件）②一句「为什么选它」。
2. 写检查器验证真实派发记录含指纹 + 理由（缺任一 ⇒ 红）。
3. **最强负控制（承重条款）**：拿一条**真实**派发记录回放，缺指纹或缺理由 ⇒ 必须报红（AC49 判据1 归属限定，落地方产出）。
4. 与 AC56 的顺序：**AC56（去序）不能先于本任务**（去了序而没有产物 = 把排序权交出去却无法核实它被怎么用了——SPEC §6）。

## Acceptance Criteria

- [ ] AC1 每条派发记录含倾向文件内容指纹 + 一句「为什么选它」。
- [ ] AC2 负控制（承重）：真实派发记录缺指纹或缺理由 ⇒ 检查变红。
- [ ] AC3 不要求 inner 解释每一次「不选」（只解释选了什么——SPEC §7）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 派发记录带指纹+理由落地 + 负控制（缺任一红）通过。
- [ ] 与 AC56 的顺序正确（AC56 不先于本任务）。

## Touches

- （inner 派发流程——派发记录写入点）
- （检查器 + 负控制 fixture）
- tasks/gap-ac55-dispatch-record-fingerprint-reason.md（自身）

## Evidence

（落地后回填）

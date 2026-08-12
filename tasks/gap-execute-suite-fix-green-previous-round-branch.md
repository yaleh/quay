---
id: gap-execute-suite-fix-green-previous-round-branch
title: execute-suite-fix Fix agent prompt 缺「上一轮为绿」分支 → 主检出绿时启动不了 worktree 验证
status: ready
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

**实证（manager 2026-08-12 代码读）**：`.claude/workflows/execute-suite-fix.js` 的 Fix agent prompt
（:95-104）分支不完备——有「真实红轮」与「非验证终态」两支，但**无「上一轮为绿」支**。当主检出
state=green（batch-merge 闸的前置条件）时，Fix agent 读 state=green 落不进 2/3 支 ⇒ 走不到第 4 步
启动 ⇒ 返回 `launched:false` ⇒ **不产出 scope=worktree 的验证记录**（worktree-green 闸的唯一数据源）。

**结构性后果**：正常「主检出绿、想合并」路径下，workflow 结构上产不出 worktree-green 记录——
这是 worktree-green 闸自设立以来 0 条记录的根因（round 45 首次满足靠的是外层直接派 verify-worktree-run，
绕开了 workflow）。

## Plan

1. 在 Fix agent prompt（:95-104）加一支：「若上一轮为绿：仍需在 worktree 启动一轮全量 suite，
   以产出 scope=worktree 的验证记录（batch-merge 闸的唯一数据源）」。
2. 一句话的改动，不动判定逻辑（:51/:148）。

## AC

- [ ] AC1: Fix prompt 增加「上一轮为绿」分支——主检出绿时仍启动 worktree 全量 suite
- [ ] AC2: 判定逻辑（:51/:148）不变
- [ ] AC3: workflow 在主检出绿时能产出 scope=worktree 记录（实测/或 prompt 结构性断言）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 改动 diff + 触发路径说明贴出（见 Evidence）
- [ ] 既有测试全绿

## Touches

- .claude/workflows/execute-suite-fix.js（Fix prompt :95-104 加分支）
- tasks/gap-execute-suite-fix-green-previous-round-branch.md（自身）

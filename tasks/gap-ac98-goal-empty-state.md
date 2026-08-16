---
id: gap-ac98-goal-empty-state
title: "AC98: /goal 空态必须指向正本（manager/outer-phase-goal），不得显示 'No goals.'"
status: todo
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC98。

**现状（审计 §1.6 + §2.4.4 实证）**：`/goal` 路由/渲染完整，但 `goals/` 目录 0 条记录；
真正的阶段目标仍在 `orchestration/manager-phase-goal.md` 与 `orchestration/outer-phase-goal.md` 里。

⛔ 本 AC 不要求推进 goal-store 迁移——那是独立的、需人裁定的方向，不得塞进本阶段当前置（硬规则⑫）。

## Acceptance Criteria

- [ ] AC1: `goals/` 为空时，`/goal` 页面 HTML 必须含指向两个 prose 正本（manager-phase-goal /
      outer-phase-goal）的路径字符串；grep 不到即假。

## Definition of Done

- [ ] `/goal` 空态指向正本路径（AC1），不显示误导性 "No goals."。

## Touches

- packages/quay/src/serve-handlers.ts（/goal 空态渲染）
- packages/quay/test/（web 测试）
- tasks/gap-ac98-goal-empty-state.md（自身）

---
id: gap-ac98-goal-empty-state
title: "AC98: /goal 空态必须指向正本（manager/outer-phase-goal），不得显示 'No goals.'"
status: done
labels:
  - gap
  - mechanism
  - priority:p1
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

- [x] AC1: `goals/` 为空时，`/goal` 页面 HTML 必须含指向两个 prose 正本（manager-phase-goal /
      outer-phase-goal）的路径字符串；grep 不到即假。

## Definition of Done

- [x] `/goal` 空态指向正本路径（AC1），不显示误导性 "No goals."。

## Evidence

**实现（serve-handlers.ts handleGoalList 空态分支）**：`goals.length === 0` 且无读错误时，渲染
`info-banner` 指向两个 prose 正本路径字符串，不再输出 `No goals.`。有筛选条件时显示「当前筛选下无记录」，
无筛选时显示「goals/ 目录为空」，二者都附正本路径。读失败时留空（上方 error-banner 已传达，不叠加误导）。

**取假**：`/goal?status=superseded`（无记录）HTML 断言含 `orchestration/manager-phase-goal.md` 与
`orchestration/outer-phase-goal.md` 且 `doesNotMatch /No goals/` —— 原行为打印 `No goals.`，此断言必然翻转。

**验证**：`bash scripts/test.sh --for-task gap-ac98-goal-empty-state --allow-thin` → tests 85 / pass 85 / fail 0。

## Touches

- packages/quay/src/serve-handlers.ts（/goal 空态渲染）
- packages/quay/test/（web 测试）
- tasks/gap-ac98-goal-empty-state.md（自身）

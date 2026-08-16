---
id: gap-fan-in-auto-close-telemetry-bracket
title: fan-in land 后不自动关 telemetry bracket——每次 land 留 stale bracket 到下一轮 reconcile（occurrence 3：ac76/ac81+touches/ac85，outer A20 驱动观察）
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

**（inner 2026-08-16 立案——outer A20 驱动第三次同形观察：fan-in land 后不自动 `--reconcile`，每 land 一条就留一个 stale bracket 到下一轮。occurrence 3 超过硬规则⑫阈值，可立案。）**

**现象**：`fan-in-execute.js` + `fan-in-ff-merge.sh` 的 flip/ff 流程**不写 `--task-end`、不调 `--reconcile`**——dispatch 时 `--task-start` 开的 telemetry bracket 从不在 land 时闭合 ⇒ 每次 land 留一个 stale bracket（`reconcile_compliant=false`），直到下一次手动/外层驱动 `--reconcile`。实测三次：ac76（08-16 02:2xZ）、ac81+touches（03:04Z）、ac85（04:09Z）。

**修法**：fan-in 流程末尾（ff-merge 成功后）自动闭合 bracket——`fast-mode-telemetry.ts --task-end --taskId <id>`（经 `closure-lag-check.sh --close-task`，A16 统一闭合点）或 `--reconcile --cap 5`。放在 ff 成功之后、返回之前。

**⛔ 注意**：fan-in workflow 是 AC78 核心机制，改动需小心（不破坏 flip/ff 主流程）；`.claude/workflows/` 是 DESIGN-INTERNAL（直修合法），但建议走 task+fan-in 以保记录（或直修 + 测试）。

**判据1**：fan-in land 后 bracket 自动闭合（land 后立即 `reconcile_compliant=true`，无需外部驱动）。
**判据2（能取假）**：不 land 的任务 bracket 不被误闭（在飞任务保留）；land 任务 bracket 闭合。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fan-in-execute.js（flip/ff 流程末尾）+ closure-lag-check.sh --close-task 用法。
2. 在 ff 成功后加 bracket 闭合（--task-end 或 --reconcile），不碰 flip/ff 主逻辑。
3. 判据2 能取假：在飞任务不被误闭。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：fan-in land 后 bracket 自动闭合（reconcile_compliant=true，无外部驱动）。
- [ ] AC2 判据2 能取假：在飞任务 bracket 保留；land 任务闭合。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in land 自动闭 bracket（occurrence 3 根治），A20 驱动不再因 fan-in 落地重复出现。

## Touches

- .claude/workflows/fan-in-execute.js（ff 成功后加 bracket 闭合）
- plugin/scripts/closure-lag-check.sh 或 fast-mode-telemetry.ts（如需，--task-end 路径）
- tasks/gap-fan-in-auto-close-telemetry-bracket.md（自身）

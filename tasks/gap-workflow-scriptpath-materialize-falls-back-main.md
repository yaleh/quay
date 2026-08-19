---
id: gap-workflow-scriptpath-materialize-falls-back-main
title: "workflow scriptPath materialize 回退主检出版——bootstrap-HIT 的 worktree 版 scriptPath 被忽略，自举修改未被自身验证"
status: todo
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

给 `Workflow` 传 `scriptPath: <worktree>/.claude/workflows/fan-in-execute.js`（bootstrap-HIT 正确用法，worktree 版含最新编排逻辑），但 materialized 脚本【两次实证】都是主检出版（无 worktree 版的最新 block）。

**影响（第 23 条实测）**：`gap-inflight-states-missing-impl-complete-event` 修改了 `fan-in-execute.js`（双拷贝），A6 自举规则要求它自己的 fan-in 用 worktree 版被自己验证——但 workflow 引擎回退主检出版，导致**第 23 条对 fan-in 编排的修改【没被自身 suite 验证】就 land**。这是 bootstrap 机制的静默失效（M176 同族：materialize 缓存/解析 bug）。

**与 M176 的区别**：M176 是 `name:` 解析缓存（workaround 是换 `scriptPath`）；本条是 `scriptPath` 本身也回退主检出版——M176 的 workaround 不适用，无已知规避。

## Acceptance Criteria

- [ ] AC1: `scriptPath: <worktree>/...` 正确 materialize worktree 版（不静默回退主检出版）；回退时 fail-closed 而非静默用旧版。
- [ ] AC2: 负控制落在生产载体——一个 bootstrap-HIT 任务的 fan-in，materialized 脚本确实含 worktree 版最新 block（读 materialized 脚本内容，非 fixture）。
- [ ] AC3: scoped 绿 + bootstrap 相关测试不红。

## Definition of Done

- [ ] worktree 版 scriptPath 被正确 materialize，bootstrap-HIT 的自举修改被自身 suite 验证（真实输出）。

## Touches

- tasks/gap-workflow-scriptpath-materialize-falls-back-main.md（自身）
- plugin/scripts/（workflow materialize / scriptPath 解析逻辑，具体模块按实现面定）
- plugin/test/（scriptPath materialize 负控制）

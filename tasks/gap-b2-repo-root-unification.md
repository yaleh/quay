---
id: gap-b2-repo-root-unification
title: B2·repo-root 合一——findRepoRoot(14)+findWorkspaceRoot(4) 三策略并存，18 处 → 1（bash+TS 成对）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

SPEC §1.6/§2.4 实测：`findRepoRoot`(14) + `findWorkspaceRoot`(4) 是**同一函数体在两个名字下逐字节重复**（5 份 body hash 相同；另有 4 处已跨文件 import 对方版本），TS 16 处 + bash 9 处三种策略并存。`path.resolve(__dirname,'..','..')` 已实测在 worktree 下解析正确（非正确性缺陷，是可维护性问题——三种策略并存）。目标是单一 `repoRoot` 实现（TS + bash 成对），其余全部引用它。

## Plan

抽 `repoRoot` 单一实现（TS 一份 + bash 一份，成对）；18 处 TS 调用点逐批迁移（每批 Touches 可控，避免大范围移动触发 §4 的目录级 Touches 自阻塞）；棘轮：新代码禁用裸 `findRepoRoot`/`findWorkspaceRoot` 重定义。⛔ 不改 `packages/`（场景 A 架构合理，§3.1）。

## Acceptance Criteria

- [ ] AC1（能取假，单一来源）：`repoRoot` 单一实现（TS + bash 成对）存在，`findRepoRoot`/`findWorkspaceRoot` 的独立定义数从 18 → 1（grep 计数）；（⛔ 仍 18 处 ⇒ 假）。
- [ ] AC2（能取假，负控制）：删共享 `repoRoot` 模块，18 处调用点的编译/运行必须红；（⛔ 删了不红 ⇒ 假——说明没真引用）。
- [ ] AC3（能取假，worktree 正确性不回归）：`repoRoot` 在 task worktree 下解析正确（`plugin/` 是真实目录非符号链接，`__dirname/../..` 到 worktree 根）——测试断言；（⛔ worktree 下解析错 ⇒ 假）。

## Definition of Done

`repoRoot` 单一实现（TS + bash）；18 处迁移完；AC1/AC2/AC3 全勾；worktree 下解析正确。

## Touches

- plugin/scripts/（repoRoot 单一实现 + 18 处迁移）
- plugin/test/（repoRoot worktree 正确性测试 + 负控制）
- tasks/gap-b2-repo-root-unification.md（自身）

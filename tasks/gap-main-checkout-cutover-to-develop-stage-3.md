---
id: gap-main-checkout-cutover-to-develop-stage-3
title: 主检出切 develop（SPEC §15.4 阶段三）——项目主工作目录保持 develop 分支（人 08:0xZ 指令①）
status: done
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**人 08:0xZ 指令①：项目主工作目录应保持 develop 分支。** 当前主检出 = **integration**
（2026-08-09 结构性修正「外层工作 checkout = integration」）。SPEC §15.4 写了五阶段，
**「主检出切 develop」（阶段三）没有任何对应任务**（`ls tasks/ | grep -icE 'main-checkout|checkout-develop|cutover'` = 0）
⇒ **人的第①条要求在任务系统里不存在，永远不会被派。** 本任务立案补上。

**与 fork-baseline 的关系（manager 2026-08-13 审计）**：`gap-worktree-fork-baseline-always-integration`
（ready ★DC）当前**把 integration fork 固化为刻意设计**——其前提被人裁（08:0xZ 指令②「任务从 develop
fork」）推翻 ⇒ **它必须反向改**（fork 源 integration → develop），否则任务永远从 integration fork，
人的目标形态（develop 主检出 + develop fork）不成立。**两条是同一切换的两半**：本任务切主检出，
fork-baseline 任务改 fork 源。

## Plan

1. 改外层工作 checkout：integration → develop（`git checkout develop`，同步外层执行核/loop 文档的
   checkout 指示——`orchestration/orchestrator-tick-core.md` + `orchestration/orchestrator-loop-tick.md`
   的「当前 checkout 是 integration」段被本指令取代）。
2. 开发模型文档更新：2026-08-09「integration 作 checkout」的结构性修正被 08:0xZ 指令取代——develop 为
   主检出，integration 的角色重新定义（或停用）。
3. 与 `gap-worktree-fork-baseline-always-integration` 配合：任务 worktree 从 develop fork。
4. 验证：主检出 = develop、外层提交落 develop、任务 worktree 从 develop fork。

## AC

- [ ] AC1: 主检出 = develop（`git branch --show-current` 验证）
- [ ] AC2: 外层一切提交落 develop
- [ ] AC3: 任务 worktree 从 develop fork（与 fork-baseline 任务配合）
- [ ] AC4: 文档更新——integration-as-checkout 的 2026-08-09 修正记录被本指令取代
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] `git branch --show-current` = develop 的样例贴出
- [ ] 全量套件绿

## Touches

- orchestration/orchestrator-tick-core.md（外层 checkout 指示）
- orchestration/orchestrator-loop-tick.md（「当前 checkout 是 integration」段）
- tasks/gap-worktree-fork-baseline-always-integration.md（fork 源 integration → develop）
- tasks/gap-main-checkout-cutover-to-develop-stage-3.md（自身）

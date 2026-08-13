---
id: gap-precommit-guard-merge-bypass
title: git merge --no-ff 绕过 pre-commit 守卫——断言面文件经 merge 落地不触发（inner 实测 2 commit→2 fire / 1 merge→0 fire；round 123 污染即活样本）
status: todo
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

**实证（inner 2026-08-13 05:20Z，git 2.43.0）**：`git merge --no-ff` **不触发 pre-commit hook**
（`git help hooks` 明写 pre-commit 仅由 git-commit(1) 调用）。实测：**2 次 commit → 2 次 fire，
1 次 merge → 0 fire**。

**活样本（round 123 污染，2026-08-13）**：inner 的 #3 fan-in（gap-tests-assert-live-repo-state，b73d4f5c）
用 `git merge --no-ff` 在轮中落地断言面文件（tasks/** + plugin/test/*.mjs + plugin/scripts/*.ts），守卫没拦
⇒ round 123 的 mixed-tree 污染（startedAt 05:11:03 verifiedCommit=776632e9，b73d4f5c 05:13:04 落地）。
**守卫覆盖不到 merge 写入路径**——不是绕过，是覆盖缺口。

**与既有守卫任务的关系**：`gap-precommit-guard-blocks-commits-not-working-tree-edits`（拦提交不拦编辑）
与 AC51（断言面拆分）解决「提交路径」；本条是 **merge 路径的覆盖缺口**——即使编辑/提交路径修好，
`git merge` 仍可绕开。**同属「守卫覆盖完整写路径」族，但 hook 面不同（commit vs merge）。**
注：守卫若覆盖 merge，A6 fan-in 在轮中 merge 会被拦——**这正是想要的行为**（A15③ 冻结规则机械化：
轮中不得写主检出）。

## Plan

修法方向（inner 建议三选，实现归内层）：
1. `prepare-commit-msg` / `post-merge` hook 覆盖 merge 路径；
2. **A6 fan-in 前置手动 `precommit-guard.ts --check`**（fan-in 是断言面落地的主要 merge 路径，前置 check 成本最低）；
3. 组合。

## AC

- [ ] AC1: `git merge --no-ff` 落地断言面文件时守卫生效（hook 或 fan-in 前置 check）
- [ ] AC2: 负控制——重现 round 123 形态（merge 落地断言面于轮中）被拦/标注
- [ ] AC3: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC3 全部勾上
- [ ] 负控制样例贴出（merge 落地断言面被拦）
- [ ] 全量套件绿

## Touches

- plugin/scripts/precommit-guard.ts（merge 路径覆盖 / fan-in 前置 check）
- orchestration/fast-mode-tick-core.md + plugin/loop/fast-mode-tick-core.md（A6 fan-in pre-check 步骤，如选方案 2）
- tasks/gap-precommit-guard-merge-bypass.md（自身）

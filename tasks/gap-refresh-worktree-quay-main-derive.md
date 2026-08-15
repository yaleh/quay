---
id: gap-refresh-worktree-quay-main-derive
title: refresh-worktree-quay.sh auto-derive 取 git worktree list 首项当 main——顺序不保证 main 在前 ⇒ verify 轮 AC4 断言失败（ff714bc0 落地新脚本真实逻辑弱点）
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

**（outer 2026-08-15 08:4xZ round197 分诊定案：refresh-worktree-quay.test.mjs AC4「root auto-derived」真实 AssertionError，C17 归 inner）**。

**现象**：`plugin/test/refresh-worktree-quay.test.mjs` AC4 断言失败（real AssertionError，非超时，@4159ms）。根因在 `plugin/scripts/refresh-worktree-quay.sh:65`：
```sh
root="$(git -C "${worktree}" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
```
**取 `git worktree list` 首项当 main checkout，但顺序不保证 main 在前** ⇒ 在 AC4 的 makeRepo 临时仓库（或一次性 verify worktree 里）可能解析到非 main worktree ⇒ 断言 false。隔离复跑 5/5 通过（makeRepo 恰好 main 在前），verify 轮里暴露。

**这是 ff714bc0（provisioning）落地的新脚本的真实逻辑弱点**——auto-derive 应选 **main worktree**（按 `[develop]`/bare / git-common-dir / 主工作树判据）而非首项。

**判据1**：`refresh-worktree-quay.sh` 的 root auto-derive 在任意 worktree 上下文中解析到**主检出**（非首项假设）。
**判据2（能取假·真样本）**：AC4 在 makeRepo 临时仓库（main 非首项的构造）+ verify worktree 上下文通过；`git worktree list` 首项非 main 时仍解析正确。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**不覆盖**：不改 refresh 的复制语义（只修 root 解析）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 refresh-worktree-quay.sh:60-70（root 解析）+ refresh-worktree-quay.test.mjs AC4（makeRepo 构造）。
2. 修法：选 main worktree（`git rev-parse --git-common-dir` 推导 / `[develop]` / bare 判据），不取首项。
3. 判据2 能取假：AC4 在 makeRepo + verify worktree 上下文通过；构造 main 非首项样本。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：root auto-derive 在任意 worktree 上下文解析到主检出（非首项假设）。
- [ ] AC2 判据2 能取假：AC4 在 makeRepo/verify worktree 通过；main 非首项构造样本正确解析。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] refresh-worktree-quay.sh root auto-derive 选 main（非首项）+ AC4 在 verify 上下文绿 + 测试绿。

## Touches

- plugin/scripts/refresh-worktree-quay.sh（root auto-derive 改选 main worktree）
- plugin/test/refresh-worktree-quay.test.mjs（AC4 补 main 非首项构造用例）
- tasks/gap-refresh-worktree-quay-main-derive.md（自身）

## Evidence

（落地后回填——round197 red：refresh-worktree-quay.test.mjs AC4 AssertionError（root 首项假设在 verify worktree 暴露）；隔离 5/5 过；根因 :65 awk 取首项）

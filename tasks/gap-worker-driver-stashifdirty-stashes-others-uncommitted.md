---
id: gap-worker-driver-stashifdirty-stashes-others-uncommitted
title: worker-driver stashIfDirty 无归属区分——定时 stash 主检出【他人】的未提交改动（任何层在主检出的未提交工作都在与它赛跑）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`worker-driver.ts` 的 `stashIfDirty`（:1085，调用于 :1407/:1742）在 checkout 前 `git stash push --include-untracked`（SPEC §5 阶段 2），**无归属区分**——它 stash 的是【主检出】上所有未提交改动，包括 manager/outer 的。manager 修公共红时连续两次编辑凭空消失（`git stash list` 直接量，我读码复核）：

```
stash@{2} 03:30:52 / stash@{1} 03:32:01 / stash@{0} 03:32:30
三条全部 "worker-driver: stash before checkout (SPEC §5 阶段 2)"，时刻与编辑逐一吻合
```
负控制（manager 做，非推断）：停机前写探针 → 10 秒消失；`driver stop` 后再写 → 15 秒仍在。⇒ `drain` 只挡新派发，driver 循环照跑、每轮 stashIfDirty 把主检出脏改动 stash 走。

**⇒ 任何层（你/我）在主检出做未提交工作，都在与它赛跑。** 什么都不丢（在 stash 里），但反复困惑，并**放大硬规则 11「add 与 commit 之间不许有等待」的必要性**——不只是怕别层提交带走、更是怕被 stash 走。

## Plan

给 stashIfDirty 加归属区分（方向候选，落笔方判）：① driver 只 stash 自己产生的未提交改动（而非全主检出脏）；② 或 driver 根本不在主检出操作、只在自己 worktree 内工作（则无需 stash 主检出）；③ 或 stash 前检查脏改动是否属于 driver（按路径/来源）。⛔ 恢复 driver 需人明示（当前 driver 已被人令停）。

## Acceptance Criteria

- [ ] AC1（能取假，不 stash 他人未提交改动）：stashIfDirty 不 stash manager/outer 在主检出的未提交改动（只 stash driver 自己的 / 或改在 worktree 内工作）；（⛔ 仍 stash 他人改动 ⇒ 假）。
- [ ] AC2（能取假，负控制）：造「driver 循环跑 + 主检出有 manager 未提交改动」场景，修复后该改动不被 stash 走、`git stash list` 无新增 "stash before checkout" 条目；（⛔ 仍被 stash ⇒ 假）。

## Definition of Done

stashIfDirty 有归属区分；AC1-AC2 全勾；主检出的他人未提交改动不再被 driver stash 走。

## Touches

- plugin/scripts/worker-driver.ts（stashIfDirty 归属区分 / 或改 worktree 内工作）
- plugin/test/worker-driver.test.mjs（负控制：他人未提交改动不被 stash）
- tasks/gap-worker-driver-stashifdirty-stashes-others-uncommitted.md（自身）

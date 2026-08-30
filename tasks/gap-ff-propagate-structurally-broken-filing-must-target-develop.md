---
id: gap-ff-propagate-structurally-broken-filing-must-target-develop
title: ff-propagate 结构不可用——立案落 main/manager-doc 靠 ff 到 develop 永远分叉；立案必须直接落 develop
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`propagateDocBranchToDevelop`（driver-filters.ts:207，ff push main/manager-doc → develop）结构上不可用：fan-in 落 develop 的「done」提交（driver 机械翻 done + merge commit）与立案落 main/manager-doc 的「ready」提交各自产生对方没有的提交 ⇒ 两分支永远分叉 ⇒ ff 永远 non-fast-forward。实证 2026-08-30：分叉 develop-only 39 / main/manager-doc-only 13，全是这个模式。正确机制：**立案直接落 develop**（与 `gap-dispatch-reads-stale-main-checkout-task-status` 读 develop 配对）。

## Plan

1. 立案提交目标分支改为 develop（过渡期 (c) 落 main/manager-doc + manager clean-window merge；dispatch 读 develop 落地后终态 (a) 用 develop worktree 提交）。
2. `propagateDocBranchToDevelop` 退役或加 guard（再有人按老模式立案落 main/manager-doc 即报红）。
3. 与 `gap-dispatch-reads-stale-main-checkout-task-status` 配对：dispatch 读 develop 后 (a) 才闭环。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：新立案提交目标分支 = develop（grep 最近立案 commit 的 parent 是 develop 非 main/manager-doc）；（⛔ 仍落 main/manager-doc ⇒ 假）。
- [ ] AC2（能取假，guard）：ff-propagate 退役或加 guard——再按老模式（立案落 main/manager-doc）立案即报红，不再静默分叉；（⛔ 仍静默 ⇒ 假）。
- [ ] AC3（能取假，配对）：`gap-dispatch-reads-stale-main-checkout-task-status` 落 done 后 (a) 闭环（dispatch 读 develop、立案落 develop 两端一致）；（⛔ 依赖未落即标闭环 ⇒ 假）。

## Definition of Done

立案目标切 develop；ff-propagate 退役或加 guard；AC1-AC3 全勾；dispatch 读 develop 与立案落 develop 两端配对闭环。

## Touches

- plugin/scripts/driver-filters.ts（propagateDocBranchToDevelop 退役或加 guard）
- plugin/scripts/ready-pool-check.ts（调用点：ff-propagate 退役后调用点移除/改）
- tasks/gap-ff-propagate-structurally-broken-filing-must-target-develop.md（自身）

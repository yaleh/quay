---
id: gap-worker-worktree-continue-reuse
title: worker 续做机制：exited-not-landed 保留的 worktree 应被重派复用（而非 create 新撞死 + 57 次重做）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

destroy-path 修复（0a8e7a8d）落地后，`exited-not-landed` 的 worktree 被**正确保留**，但派发路径仍是 `buildWorkerPrompt` 逐字要求「create an isolated git worktree」（创建，非复用）⇒ **下一个重派 worker 一上来就撞死**：`git worktree add` 撞已存在对象硬失败（路径+分支都存在 → `fatal: a branch named 'task/<id>' already exists`；仅路径存在 → `fatal: ... already exists`，manager 实测）。

**收益量化（139 条 worker-outcome 分布）**：`exited-not-landed` **57 次**——每次都是「套件绿 + 实现完成，只差 AC 勾选或 ff 竞速」。这些 worktree 现在被保留但**没人接着做**，下次重派从头再来 = 57 次量级的重复实现劳动。且当前「保留但不复用」会让下一个 worker 撞死（阻塞重派），是 destroy-path 修复的必要补全。

## Plan

worker prompt 改为「复用已有 worktree，无则创建」；或 driver 派发前检测已有 worktree ⇒ 走续做 prompt（非新建 prompt）。⛔ 续做 prompt 需让 worker 知道「前一轮做到哪」：至少（分支已有提交 / AC 勾选状态 / 上次失败原因），否则它会重做已完成部分。

## Acceptance Criteria

- [x] AC1（能取假，复用不撞死）：exited-not-landed 保留 worktree 的任务重派时，worker 复用该 worktree（⛔ `git worktree add` 撞已存在对象报 fatal ⇒ 假）。
- [x] AC2（能取假，续做不重做）：续做 prompt 携带前一轮状态（分支提交 / AC 勾选 / 失败原因），worker 从保留的 worktree 继续（⛔ prompt 仍只说「create」或零状态 ⇒ 假）。

## Definition of Done

续做机制落地 develop；AC1-2 全勾；一个 exited-not-landed 的任务重派后复用原 worktree 继续（AC1 复现，不撞死不重做）。

## Touches

- plugin/scripts/worker-driver.ts（buildWorkerPrompt 复用/续做 prompt + 派发前 worktree 检测）
- plugin/test/worker-driver.test.mjs（AC1-2 复现）
- tasks/gap-worker-worktree-continue-reuse.md（自身）
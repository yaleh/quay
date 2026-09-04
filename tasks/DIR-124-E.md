---
id: DIR-124-E
title: Schedule milestone stages across candidates with explicit resource
  semaphores and measured backpressure
status: done
labels:
  - directive
  - human-steered
parent: DIR-124
children: []
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124 一并关闭）**

原标题：Schedule milestone stages across candidates with explicit resource semaphores and measured
backpressure。Proposal 原文明确：「Use [[DIR-123]] worktrees, [[DIR-124-B]] receipts,
[[DIR-124-C]] stage adapters, and [[DIR-124-D]] resource profiles」——**B/C/D 均已同批关闭**，本任务
的三个直接依赖全部失效，是纯粹的依赖性作废（本任务体自身不直接命中 `execute-milestone.js` 等关键词，
但其全部机制都建立在已关闭的 B/C/D 之上）。

意见：见父任务 `DIR-124` 关闭说明。「资源感知的跨阶段调度」这个价值目标本身仍然成立（今晚
`gap-4core-shared-budget` 一类问题正是同一族），若要落地应针对当前 fast-mode 的 4 核共享预算问题
重新提案，而不是复用为已删除的 composite pipeline 设计的信号量机制。

全文见 git 历史（`git log -p -- tasks/DIR-124-E.md`）。

## Proposal

Use [[DIR-123]] worktrees, [[DIR-124-B]] receipts, [[DIR-124-C]] stage adapters, and
[[DIR-124-D]] resource profiles to schedule stages—not whole milestone workflows—across selected
candidates. Allow Verify, Build, Audit, and Gate work from different milestones to overlap while
bounded semaphores prevent full-suite, port, CPU, memory, agent, package-build, and integration
contention.

This child is the first resource-aware pipeline release. Preserve one fenced integration writer and
a conservative serial fan-in/Land policy initially. Use real measurements to decide whether a
separate rolling Ready-to-Land/effect-lease child is worth its additional recovery complexity.

## Touches
- tasks/DIR-124-E.md（自身文件）

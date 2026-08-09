---
id: DIR-124-B
title: Single-source milestone RunIdentity, stage journal, hash-bound receipts,
  Verify cache, and explicit resume
status: done
labels:
  - directive
  - human-steered
parent: DIR-124
children:
  - DIR-124-B1
  - DIR-124-B2
  - DIR-124-B3
  - DIR-124-B4
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124 一并关闭）**

原标题：Single-source milestone RunIdentity, stage journal, hash-bound receipts, Verify cache, and
explicit resume。Touches 直指 `.claude/workflows/execute-milestone.js`——**已被 ADR-022
（2026-08-03 accepted）物理删除**。

实测：本任务体对 `execute-milestone.js`/`composite-` 等关键词命中 16 处（含子任务 B1-B4 均已 split
出去，各自独立 M-number，同样面临同一根因）。

意见：见父任务 `DIR-124` 关闭说明。RunIdentity/StageReceipt/journal/resume 这类概念若仍有价值，
应对照当前 fast-mode 的 worktree-per-task 执行模型重新设计，而不是复用这份为已删除引擎写的契约。

全文见 git 历史（`git log -p -- tasks/DIR-124-B.md`）。

## Touches
- tasks/DIR-124-B.md（自身文件）

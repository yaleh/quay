---
id: DIR-124-A
title: Establish milestone-workflow observability, invariant ownership, and
  golden replay before control-plane refactoring
status: done
labels:
  - directive
  - human-steered
parent: DIR-124
children:
  - DIR-124-A1
  - DIR-124-A2
  - DIR-124-A3
  - DIR-124-A4
  - DIR-124-A5
extra:
  dirStatus: applied
  schema: v1
---

**type:** execution

**ADR-022 关闭（2026-08-09，manager 代写，人 17:4x 裁定关闭，随父任务 DIR-124 一并关闭）**

原标题：Establish milestone-workflow observability, invariant ownership, and golden replay before
control-plane refactoring。Proposal 明确是「the C0 layer from
`docs/proposals/quay-milestone-workflow-git-crystallization.md`」，目标是为 DIR-124-B/C/D/E 的
control-plane 重构打前站——**目标本身（`.claude/workflows/execute-milestone.js` 的重构）已被
ADR-022（2026-08-03 accepted）物理删除**，前站工作失去意义。

实测：`grep -c "execute-milestone\.js\|prepare-milestone\.js\|composite-"` 本任务体命中 34 处。

意见：见父任务 `DIR-124` 关闭说明。若需要恢复此类可观测性/golden-replay 基线能力，应针对当前
fast-mode 架构重新提案。

全文见 git 历史（`git log -p -- tasks/DIR-124-A.md`）。

## Touches
- tasks/DIR-124-A.md（自身文件）

---
id: DIR-124-D
title: Single-source milestone execution policy and subtract duplicate prompt
  and OUTER-LOOP control rules
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

原标题：Single-source milestone execution policy and subtract duplicate prompt and OUTER-LOOP
control rules。Proposal 明确依赖 [[DIR-124-C]] 的 kernel——DIR-124-C 已关闭（同批），本任务的载体
（policy registry 被 [[DIR-124-C]] kernel 消费）随之失效；Touches 也直指
`.claude/workflows/execute-milestone.js`/`prepare-milestone.js`，均已被 ADR-022 物理删除。

实测：本任务体对 `composite-build`/`composite-audit`/`composite-reconcile` 等关键词命中 8 处。

意见：见父任务 `DIR-124` 关闭说明。「重复规则应有单一可执行所有者」这条原则本身仍然成立，若要落地
应对照当前 fast-mode 的散文行/执行核重复问题（正是 manager 今晚新立的 ADR-033 场景）重新提案。

全文见 git 历史（`git log -p -- tasks/DIR-124-D.md`）。

## Touches
- tasks/DIR-124-D.md（自身文件）

---
id: DIR-124-C
title: Extract a deterministic milestone control-plane kernel and narrow Stage
  Adapter ABI from the prompt workflow
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

原标题：Extract a deterministic milestone control-plane kernel and narrow Stage Adapter ABI from
the prompt workflow。Problem framing 原文开篇即引用「The installed execution driver
`.claude/workflows/execute-milestone.js` is 1257 lines」——**该文件已被 ADR-022（2026-08-03
accepted）物理删除**，kernel 抽取的对象不复存在。

实测：本任务体对 `execute-milestone.js`/`composite-` 等关键词命中 48 处，是本批中依赖最深的一份。

意见：见父任务 `DIR-124` 关闭说明。

全文见 git 历史（`git log -p -- tasks/DIR-124-C.md`）。

## Touches
- tasks/DIR-124-C.md（自身文件）

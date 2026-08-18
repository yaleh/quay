---
id: gap-webui-sessions-no-layer-labels
title: "/sessions 页缺分层标签——全篇无 Manager/Outer/Inner 分节标题，内容是扁平文本"
status: todo
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`/sessions` 页全篇零个 `<h2>Manager/Outer/Inner</h2>` 分节标题，内容是扁平文本。数据本身应已按角色分开（页面知道要显示哪层），大概率只是渲染层没加分节——小改动。

## Acceptance Criteria

- [ ] AC1: `/sessions` 页按 Manager/Outer/Inner 分节渲染（分节标题）。
- [ ] AC2: 每节下内容按层归属（不混排）。

## Definition of Done

- [ ] `/sessions` 页可见三层分节标题（真实渲染）。

---
id: gap-webui-board-no-pagination
title: "/board 1257 行零分页零筛选——需服务端分页（query param）+ status/label 筛选"
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

`/board` 渲染 1257 行、零分页零筛选。建议：服务端分页（query param 形式，不引入客户端 JS，与项目「零客户端 JS」取向一致）+ 按 status/label 筛选。

## Acceptance Criteria

- [ ] AC1: `/board` 支持服务端分页（query param，如 `?page=N`）。
- [ ] AC2: 支持按 status/label 筛选。
- [ ] AC3: 不引入客户端 JS（保持「零客户端 JS」取向）。

## Definition of Done

- [ ] `/board?page=2` 返回第二页、`?status=<s>` 筛选生效（真实输出，全程不引入客户端 JS）。

## Touches

- tasks/gap-webui-board-no-pagination.md（自身）

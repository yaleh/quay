---
id: gap-git-history-route-registered-twice
title: "/git-history 路由注册两次（serve-handlers.ts:2485/:2500），第二处结构上永远走不到（死代码）"
status: ready
labels:
  - gap
  - defect
  - webui
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`packages/quay/src/serve-handlers.ts:2485` 和 `:2500` 都有 `if (url.pathname === "/git-history")`——第二处结构上永远走不到（第一处已匹配并 return），是死代码。纯代码事实，不涉及设计取舍。

## Acceptance Criteria

- [ ] AC1: 移除第二处死代码注册（:2500），保留一处。
- [ ] AC2: 负控制——移除死代码后 `/git-history` 路由行为不变（仍正常渲染 SVG + HTML 页）。

## Definition of Done

- [ ] `grep serve-handlers.ts 'url.pathname === "/git-history"'` 只剩 1 处命中。

## Touches

- tasks/gap-git-history-route-registered-twice.md（自身）

---
id: gap-git-history-clickable-branches-window
title: Git History 分支名可点击（链 /task/<id>）+ 放宽 24h 窗口
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 需求分析投立案（人产品要求 Git History 页重做，两条低成本项）。

**④ 分支可点击**：现状 `serve-handlers.ts` 分支名是纯文本（`<text class="git-svg-ink">${escapeHtml(b.ref)}</text>` 无 `<a>`）；`/task/<id>` 详情页已存在，分支名去 `task/` 前缀即映射任务 id。

**③ 看更多历史**：现状 `observation.ts:974-1040` `GIT_HISTORY_ACTIVE_WINDOW_SEC=24h`，tip 提交超 24h 的分支不再单独成泳道（`master` 也被排除）。

## Plan

1. ④：分支名包 `<a href="/task/<id>">`（去 `task/` 前缀映射任务 id）。
2. ③：24h 窗口放宽——始终包含 develop/master + 最近 N 天活跃分支（N 落笔方定）。

## Acceptance Criteria

- [ ] AC1：Git History 页分支名可点击，链到对应 `/task/<id>`（⛔ 纯文本无链接 ⇒ 假）。
- [ ] AC2：master 及超 24h 分支也可见（⛔ 24h 窗口把 master 排除 ⇒ 假）。

## Definition of Done

- [ ] 分支可点击 + 窗口放宽落地；AC1-2 全勾；land 到 develop。

## Retires

- 无（渲染链接 + 过滤参数调整）

## Touches

- packages/quay/src/serve-handlers.ts（分支名链 /task/<id>）
- packages/quay/src/observation.ts（GIT_HISTORY_ACTIVE_WINDOW 放宽）
- packages/quay/test/serve-handlers.test.mjs
- packages/quay/test/observation.test.mjs
- tasks/gap-git-history-clickable-branches-window.md（自身）

## Needs-Human

**执行 2026-08-23T04:14:47.064Z — promotion-driver AC133：连续修满上限仍不合格**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）

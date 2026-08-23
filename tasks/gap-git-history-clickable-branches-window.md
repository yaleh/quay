---
id: gap-git-history-clickable-branches-window
title: Git History 分支名可点击（链 /task/<id>）+ 放宽 24h 窗口
status: done
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

- [x] AC1：Git History 页分支名可点击，链到对应 `/task/<id>`（⛔ 纯文本无链接 ⇒ 假）。
- [x] AC2：master 及超 24h 分支也可见（⛔ 24h 窗口把 master 排除 ⇒ 假）。

## Definition of Done

- [x] 分支名链 `/task/<id>` + `GIT_HISTORY_ACTIVE_WINDOW` 放宽（含 master）落地；AC1-2 全勾；land 到 develop。


> **手动介入记录（AC141-2 例外①）**：driver 误记 completed ⇒ 候选计算中永久排除 ⇒ 跨 round 4/5/6 两小时未重派 ⇒ inner 手动 re-trigger fan-in（判据：无记录的手动介入 ⇒ AC141-1 判假）。
## Retires

- 无（渲染链接 + 过滤参数调整）

## Touches

- packages/quay/src/serve-handlers.ts（分支名链 /task/<id>）
- packages/quay/src/observation.ts（GIT_HISTORY_ACTIVE_WINDOW 放宽）
- packages/quay/test/serve-handlers.test.mjs
- packages/quay/test/observation.test.mjs
- tasks/gap-git-history-clickable-branches-window.md（自身）

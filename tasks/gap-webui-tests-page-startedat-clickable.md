---
id: gap-webui-tests-page-startedat-clickable
title: Tests 页补 startedAt 时间戳列 + 行可点击（commit 链 git-history）
status: ready
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

**来源**：manager web 巡检投立案（代码级核实，非推断）。

**证据**：`serve-handlers.ts:2294-2301` `historyRows` 渲染 round/state/pass-fail-cancel/duration/scope/buckets/commit 七列，**唯独没有 `r.startedAt`**；而载体 `.quay/verification-round.jsonl` 每轮都有 `startedAt`（如 `"startedAt":"2026-08-23T01:57:10.824Z"`）⇒ 数据在、模板没渲染。a11y 快照确认整行纯 `StaticText`，零 `link`/`button`，commit 列同为纯文本本可链 Git History。

## Plan

1. 模板加一列 `startedAt`（`escapeHtml` + 格式化）。
2. 每行包 `<a href="/tests/<round>">` 或至少 commit 列链到 `/git-history?commit=`。

## Acceptance Criteria

- [x] AC1：Tests 页每行渲染 `startedAt` 时间戳（取自载体，非硬编码）。
- [x] AC2：行可点击（整行链 `/tests/<round>`，或 commit 列链 `/git-history?commit=`），⛔ 非纯 StaticText。

## Definition of Done

- [ ] startedAt 列 + 行可点击落地；AC1-2 全勾；land 到 develop。

## Retires

- 无（渲染补全）

## Touches

- packages/quay/src/serve-handlers.ts（historyRows 渲染）
- packages/quay/test/serve-handlers.test.mjs（startedAt 列 + 行可点测试）
- tasks/gap-webui-tests-page-startedat-clickable.md（自身）

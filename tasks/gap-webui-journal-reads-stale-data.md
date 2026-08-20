---
id: gap-webui-journal-reads-stale-data
title: "Journal 页读陈旧数据——observation.ts readRecentTableRows 只认 Markdown 表格行，而 tick-log.md 已改 ## 时间戳散文格式"
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

`packages/quay/src/observation.ts:367 readRecentTableRows` 只认以 `|` 开头的 Markdown 表格行（取文件里第一个表格块，从头找不从尾找），但 `orchestration/tick-log.md`（`TICK_LOG_FILE`）早已改用 `## 时间戳` + 散文格式（本会话全部条目都是散文，`head -20 orchestration/tick-log.md | grep -cE '^\|'` = 0）。⇒ Journal 页在找一种已不存在的旧格式，显示陈旧数据（manager 实测最新日期停在 2026-08-14，而 tick-log 今天有 09:44Z 条目，差 4 天）。

## Acceptance Criteria

- [x] AC1: Journal 页读取 tick-log 最新条目（`## 时间戳` + 散文格式），不再找已废弃的表格块。
- [x] AC2: 负控制——tick-log 有今日条目时 Journal 页显示今日（非陈旧 08-14）。
- [x] AC3: 反向对照——tick-log 缺失/空时报 empty，不误报有数据（fail-closed 保持）。

## Definition of Done

- [x] Journal 页显示 tick-log 最新条目（真实输出，非 fixture）。

## Touches

- packages/quay/src/observation.ts
- packages/quay/test/serve.test.mjs
- tasks/gap-webui-journal-reads-stale-data.md（自身）

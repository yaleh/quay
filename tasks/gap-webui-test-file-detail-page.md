---
id: gap-webui-test-file-detail-page
title: 新增独立单测试文件详情页（/tests/file?path=...）：跨多轮历史时间线 + 运行期间负载曲线片段
status: done
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

web /tests 页缺**独立单测试文件详情页**（人明确要求，非「tests 页本身够了」）。现状（manager 2026-08-24 代码实测）：`gap-webui-tests-page-startedat-clickable`（done）只实现**轮次行**点击→`/git-history?commit=<sha>`，非「点某测试文件→看该文件自己的记录」；`serve-handlers.ts` 只命中一处 `/tests` 路由，无 `/tests/<id>`；`gap-test-detail-timeline`/`gap-test-detail-load-timeseries`（done）建的甘特图+负载曲线其实都在 `/tests` 页里，无独立页。

## Plan

新增路由 `/tests/file?path=<repo-rel-path>`，单文件跨多轮视图：①该文件历史时间线（durationMs 趋势 + pass/fail 历史）；②该文件运行期间负载曲线片段（⛔ 依赖 gap-suite-load-sampler-bypassed-by-fan-in-execute 先修好，否则空——本页其它部分不依赖）；③`/tests` 页 perFile 表格/甘特图行加链接指向新页。

## Acceptance Criteria

- [x] AC1（能取假，独立路由）：`/tests/file?path=<repo-rel-path>` 返回单文件详情（⛔ 仍只有 /tests 一页 ⇒ 假）。
- [x] AC2（能取假，跨多轮历史）：详情页显示该文件跨多轮 durationMs 趋势 + pass/fail 历史（⛔ 只有单轮 ⇒ 假）。
- [x] AC3（能取假，入口链接）：/tests 页 perFile 行可点击跳到详情页（⛔ 无链接 ⇒ 假）。

## Definition of Done

独立详情页落地 develop；AC1-3 全勾；点某测试文件→新页看跨多轮历史（AC2 复现）；负载曲线片段随 sampler-bypass 修复后显示（AC1 页存在即算，负载曲线是数据源依赖项）。

## Touches

- packages/quay/src/serve-handlers.ts（新 /tests/file 路由 + 详情渲染）
- packages/quay/src/serve.ts（路由接线）
- packages/quay/test/serve-handlers.test.mjs（或对应测试）
- tasks/gap-webui-test-file-detail-page.md（自身）
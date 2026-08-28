---
id: gap-webui-bucket-color-distinction
title: web /tests 甘特图 + 时间线加 bucket 颜色区分（P/M/P+M/full 各一色，bucketSetOf 查路径 + 图例）
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

web /tests 页甘特图 + 时间线缺 **bucket 颜色区分**（manager 2026-08-24 代码实测）：`renderPerFileTimelineSvg()`（serve-handlers.ts:2726）的 perFile 字段 = `{file,durationMs,passed,startedAtMs,endedAtMs}`——无 bucket 字段，颜色只按 pass/fail 区分；`verification-round.jsonl` 的 perFile 记录也不带 bucket。任务库无匹配，全新未立过案。**已有可复用数据源**：`plugin/scripts/suite-bucket-attribution.ts` 的 `bucketSetOf(fileRef, root)` 可按路径查 bucket（P/M/P+M/full），渲染时查一次即可，不需新采集。

## Plan

甘特图 + 未来新详情页时间线加 bucket 颜色：渲染时用 `bucketSetOf()` 查每文件 bucket，配色 P/M/P+M/full 各一色 + 图例说明。

## Acceptance Criteria

- [x] AC1（能取假，颜色区分）：甘特图按 bucket 着色（⛔ 仍只 pass/fail 两色 ⇒ 假）。
- [x] AC2（能取假，数据源正确）：bucket 由 `bucketSetOf(fileRef, root)` 查得（⛔ 硬编码/新采集 ⇒ 假）。
- [x] AC3（能取假，图例）：有图例说明各 bucket 颜色含义（⛔ 无图例 ⇒ 假）。

## Definition of Done

bucket 颜色落地 develop；AC1-3 全勾；甘特图按 `bucketSetOf` 的 P/S/M（多桶/未解析）各一色 + 图例（AC1 复现）。

## Touches

- packages/quay/src/serve-tests.ts（renderPerFileTimelineSvg 按 bucket 着色 + bucketSetOf 镜像 + 图例）
- packages/quay/src/serve-render.ts（gantt-bucket-* token CSS）
- packages/quay/test/serve-handlers.test.mjs（AC1/AC2/AC3 bucket 测试）
- tasks/gap-webui-bucket-color-distinction.md（自身）
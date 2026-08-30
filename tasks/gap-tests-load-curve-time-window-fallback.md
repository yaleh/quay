---
id: gap-tests-load-curve-time-window-fallback
title: "/tests 负载解析鲁棒化——runId 精确命中 + 时间窗回退，恢复 #692 起错键轮次的曲线"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

/tests 的负载查找只按 `record.runId` 精确匹配 `suite-load-<runId>.jsonl`。机械 fan-in 路径的 runId 键断裂（红记录 wk-prod、绿记录无 runId，而 load 文件键是 runner UUID / fm-*）⇒ #692 起测试详情页无负载数据。修复 runId 统一（gap-mechanical-fan-in-per-suite-runid-unified）只覆盖新轮；历史错键轮次（#692+）仍需恢复。

设计：load 查找改为**两级解析**——① 按 record.runId 精确命中（修好键后新轮即中）；② 缺失/不匹配时按时间窗回退：在 `.quay/suite-load-*.jsonl` 里找样本落在该轮 `[startedAt, startedAt+durationMs]` 窗口内的文件（对 ~200 个文件建 min/max 样本时间小索引，避免全量扫描每次读全文件）。页面不再依赖写入方 id 约定（与严格历史同源：显示层不依赖控制面/写入方内部形态）。

## Plan

1. serve-tests.ts `readSuiteLoadSamples` 增加窗口解析路径：扫描 suite-load-*.jsonl 文件名列表 + 各文件首末样本时间索引，按轮窗口匹配。
2. `handleTests` 的 samples 计算：record.runId 命中优先，落空则窗口回退（对 selected 轮与默认最新轮都适用）。
3. 测试：runId 命中（现有 fixture）、错键轮靠窗口回退命中、无窗口（legacy 无 durationMs）容忍。

## Acceptance Criteria

- [ ] AC1（能取假，历史恢复）：对一条 runId 与实际 load 文件键不符的历史轮（如 #692），页面出现该轮负载曲线（窗口回退命中）。
- [ ] AC2（能取假，主路径不回归）：runId 精确命中的轮照常出曲线（优先于窗口回退）。
- [ ] AC3（能取假，负控制）：窗口无匹配样本（或该轮无 load 文件）⇒ 无曲线、不报错不 500。

## Definition of Done

/tests 与 /tests/file 对 #692 起的错键轮次显示负载曲线（真实数据、非 fixture）；runId 命中路径不回归。

## Touches

- packages/quay/src/serve-tests.ts（load 两级解析）
- packages/quay/test/serve-handlers.test.mjs（窗口回退正/负控制）
- packages/quay/test/serve-ac95-views.test.mjs（回归）
- tasks/gap-tests-load-curve-time-window-fallback.md（自身）
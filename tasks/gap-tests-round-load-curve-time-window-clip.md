---
id: gap-tests-round-load-curve-time-window-clip
title: /tests?round=N 负载曲线未按该轮时间窗裁剪——显示窗外数据（1552.6s vs 真实 437.5s）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`packages/quay/src/serve-tests.ts` 的 `/tests?round=N` 页面 `roundLabel(focus)` 正确显示对应轮次（取该轮自己的元数据），但**负载曲线画的数据没按该轮时间窗裁剪**——`readSuiteLoadSamples()` 读整份 `.quay/suite-load-<runId>.jsonl`，不过滤 `t` 是否落在 `[startedAt, startedAt+durationMs]` 内。**对照**：同文件 `/tests/file`（单文件详情页，`:546`）已做 `.filter(s => s.t >= start && s.t <= end)`，唯独主 round 页漏了这一步。

**实证**（人报 + manager 核实）：round #560 标签显示「round #560」，但实际画的数据跨度 1552.6s（真实 `durationMs`=437.5s），中间还有 449.9s 采样缺口。

**与 ① 的关系**：这是 `gap-suite-load-sampler-orphan-process`（孤儿 sampler 不停写）的下游表现——sampler 不停 + 页面无裁剪两个条件叠加才把不属于这一轮的数据显示成这一轮。但这是**独立于 ① 的第二个真实缺陷**：即便 ① 修好、sampler 正确终止，前端防御性裁剪缺失依然值得补——不管将来任何原因导致数据跨轮混入，页面本不该显示超出自己声明窗口的数据。两处消费同一份数据，一个防了一个没防。

## Plan

给主 round 页加上 `/tests/file` 已有的时间窗过滤（两处复用同一逻辑）。

## Acceptance Criteria

- [ ] AC1（能取假，时间窗裁剪）：`/tests?round=N` 负载曲线数据按 `[startedAt, startedAt+durationMs]` 裁剪（不显示窗外数据）；（⛔ 仍显示窗外数据 ⇒ 假）。
- [ ] AC2（能取假，两处一致）：与 `/tests/file` 复用同一时间窗过滤逻辑（两处同一份数据都防）；（⛔ 两处逻辑不一致 ⇒ 假）。

## Definition of Done

主 round 页负载曲线按 `[startedAt, startedAt+durationMs]` 时间窗裁剪、不显示窗外数据；AC1-2 全勾；两处（/tests/file 与主 round 页）复用同一时间窗过滤逻辑；对应测试通过。

## Touches

- packages/quay/src/serve-tests.ts（/tests?round=N 负载曲线过滤）
- packages/quay/test/serve-handlers.test.mjs（对应测试——与既有 serve-tests 测试同文件）
- tasks/gap-tests-round-load-curve-time-window-clip.md（自身）
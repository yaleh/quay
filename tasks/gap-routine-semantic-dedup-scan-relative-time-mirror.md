---
id: gap-routine-semantic-dedup-scan-relative-time-mirror
title: "semantic-dedup-scan: Same algorithm under two names,
  statement-for-statement identical (sub-60s just now, then 60s/60m/24h
  thresholds); flags.ts documents it as a deliberate mirror"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Same algorithm under two names, statement-for-statement identical (sub-60s just now, then 60s/60m/24h thresholds); flags.ts documents it as a deliberate mirror to avoid importing serve machinery, a reason that no longer applies to serve-render.ts.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791353789266` · ts `2026-10-07T06:16:29.266Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`relativeTimeCli`、`relativeTime`
- 涉及文件：
- `packages/quay/src/cli/flags.ts:160`
- `packages/quay/src/serve-render.ts:760`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract one relativeTime into a leaf and re-export both names

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `relative-time-mirror`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791353789266`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/cli/flags.ts`
- `packages/quay/src/serve-render.ts`
- `tasks/gap-routine-semantic-dedup-scan-relative-time-mirror.md`
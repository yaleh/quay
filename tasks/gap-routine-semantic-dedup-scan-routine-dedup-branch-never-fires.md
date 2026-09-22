---
id: gap-routine-semantic-dedup-scan-routine-dedup-branch-never-fires
title: "semantic-dedup-scan: The gate documents dedup 'by a stable finding key'
  (routine-file-gate.ts:5) but across 6 semantic-dedup-scan rounds 0 of 264
  rejections carry the 'dedup:' reas"
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
The gate documents dedup 'by a stable finding key' (routine-file-gate.ts:5) but across 6 semantic-dedup-scan rounds 0 of 264 rejections carry the 'dedup:' reason (238=rate, 26=action) while the SAME clusters recur every round under a regenerated slug (manifest.ts: provider-manifest-clone/readmanifest-byte-identical/readmanifest-provider-twin/readmanifest-triplicated/readmanifest), so findingKey()'s normalized-finding-text key never matches across rounds and only the rate cap throttles.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790118332027` · ts `2026-09-22T23:05:32.027Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`findingKey`、`gateFinding`
- 涉及文件：
- `plugin/scripts/routine-file-gate.ts:45`
- `plugin/scripts/probe-routine.ts:365`
- `.quay/routine-findings.jsonl`
- kind：`other`
- verdict：`divergent-implementation`

## Requested action
stabilize the cross-round finding key so the dedup branch can fire

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `routine-dedup-branch-never-fires`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790118332027`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/routine-file-gate.ts`
- `plugin/scripts/probe-routine.ts`
- `tasks/gap-routine-semantic-dedup-scan-routine-dedup-branch-never-fires.md`
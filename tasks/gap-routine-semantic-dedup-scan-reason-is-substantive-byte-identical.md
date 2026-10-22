---
id: gap-routine-semantic-dedup-scan-reason-is-substantive-byte-identical
title: "semantic-dedup-scan: Bodies are character-identical and both compare
  against a locally re-declared MIN_REASON_CHARS = 8;
  semantic-face-dispatch-record imports only isDirectEntry, s"
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
Bodies are character-identical and both compare against a locally re-declared MIN_REASON_CHARS = 8; semantic-face-dispatch-record imports only isDirectEntry, so the two thresholds can drift independently.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792647604889` · ts `2026-10-22T05:40:04.889Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`reasonIsSubstantive`、`MIN_REASON_CHARS`
- 涉及文件：
- `plugin/scripts/dispatch-record.ts:102`
- `plugin/scripts/semantic-face-dispatch-record.ts:89`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `reason-is-substantive-byte-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792647604889`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/dispatch-record.ts`
- `plugin/scripts/semantic-face-dispatch-record.ts`
- `tasks/gap-routine-semantic-dedup-scan-reason-is-substantive-byte-identical.md`
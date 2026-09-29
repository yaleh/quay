---
id: gap-routine-semantic-dedup-scan-baseline-reader-septuplication
title: "semantic-dedup-scan: One behavior copied seven times (bodies hash
  identically after name/path normalization): read the ratchet file, parse
  baseline-count, set of non-comment lines,"
status: todo
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
One behavior copied seven times (bodies hash identically after name/path normalization): read the ratchet file, parse baseline-count, set of non-comment lines, plus a three-copy shrink-only writer that diverged only in its reason string; no shared ratchet-baseline module exists.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790678624535` · ts `2026-09-29T10:43:44.535Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readBaseline`、`readDodSuiteLineBaseline`、`readBareDirTouchesBaseline`、`readWiringClaimAcProbeBaseline`、`readRatchet`、`readOneEntryBaseline`、`writeBaseline`、`writeRatchet`
- 涉及文件：
- `plugin/scripts/task-ac-carryover-check.ts:213`
- `plugin/scripts/task-contract-check.ts:244`
- `plugin/scripts/task-contract-check.ts:283`
- `plugin/scripts/task-contract-check.ts:327`
- `plugin/scripts/task-contract-check.ts:426`
- `plugin/scripts/touches-one-entry-one-path-check.ts:201`
- `plugin/scripts/threshold-scope-check.ts:386`
- kind：`identity-replication`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `baseline-reader-septuplication`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790678624535`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/scripts/task-contract-check.ts`
- `plugin/scripts/touches-one-entry-one-path-check.ts`
- `plugin/scripts/threshold-scope-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-baseline-reader-septuplication.md`
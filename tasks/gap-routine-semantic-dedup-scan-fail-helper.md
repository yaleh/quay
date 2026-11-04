---
id: gap-routine-semantic-dedup-scan-fail-helper
title: "semantic-dedup-scan: Identical fail(msg) except per-script log prefix;
  both emit {ok:false,error} in --json mode else stderr and return 2."
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
Identical fail(msg) except per-script log prefix; both emit {ok:false,error} in --json mode else stderr and return 2.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793780123988` · ts `2026-11-04T08:15:23.988Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`fail`
- 涉及文件：
- `plugin/scripts/per-task-suite-record.ts:391`
- `plugin/scripts/pre-verified-round-record.ts:1002`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T08:15:23.988Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `fail-helper`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793780123988`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/per-task-suite-record.ts`
- `plugin/scripts/pre-verified-round-record.ts`
- `tasks/gap-routine-semantic-dedup-scan-fail-helper.md`
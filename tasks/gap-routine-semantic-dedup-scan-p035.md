---
id: gap-routine-semantic-dedup-scan-p035
title: "semantic-dedup-scan: Diff of the two regions is clean, including the
  absent-file return null and the {__unparseable:true} sentinel that keeps line
  counts comparable: a contract the"
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
Diff of the two regions is clean, including the absent-file return null and the {__unparseable:true} sentinel that keeps line counts comparable: a contract the shared readJsonLines (returns []) cannot express.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790592211995` · ts `2026-09-28T10:43:31.995Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readJsonlLines`
- 涉及文件：
- `plugin/scripts/direct-to-develop-bypass-check.ts:926`
- `plugin/scripts/fan-in-ff-protocol-check.ts:280`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract the counting variant; do NOT point both at readJsonLines whose fail-open form loses the malformed row

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `p035`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790592211995`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/direct-to-develop-bypass-check.ts`
- `plugin/scripts/fan-in-ff-protocol-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-p035.md`

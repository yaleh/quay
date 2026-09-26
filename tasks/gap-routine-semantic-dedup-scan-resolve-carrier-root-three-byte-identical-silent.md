---
id: gap-routine-semantic-dedup-scan-resolve-carrier-root-three-byte-identical-silent
title: "semantic-dedup-scan: three digest-identical copies with the same name,
  one already exported so the others could import it today, and the consumer
  fails closed only for an ABSENT ca"
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
three digest-identical copies with the same name, one already exported so the others could import it today, and the consumer fails closed only for an ABSENT carrier so a wrong-but-existing root yields an empty baseline silently

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790417424782` · ts `2026-09-26T10:10:24.782Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveCarrierRoot`
- 涉及文件：
- `plugin/scripts/perfile-failure-rate.ts:154`
- `plugin/scripts/psi-failure-correlation-check.ts:214`
- `plugin/scripts/psi-window-join.ts:141`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge - both other sites import the exported resolveCarrierRoot

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `resolve-carrier-root-three-byte-identical-silent-zero`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790417424782`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/perfile-failure-rate.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/psi-window-join.ts`
- `tasks/gap-routine-semantic-dedup-scan-resolve-carrier-root-three-byte-identical-silent.md`
---
id: gap-routine-semantic-dedup-scan-p015
title: "semantic-dedup-scan: Byte-identical 4-line helper (writeHead
  application/json then end(JSON.stringify)) in the same package and same
  HTTP-handler idiom."
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
Byte-identical 4-line helper (writeHead application/json then end(JSON.stringify)) in the same package and same HTTP-handler idiom.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790592211995` · ts `2026-09-28T10:43:31.995Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`writeJson`
- 涉及文件：
- `packages/quay/src/serve-git.ts:1073`
- `packages/quay/src/serve-sessions.ts:690`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract (one shared http-json util next to the serve-* modules)

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `p015`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790592211995`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve-git.ts`
- `packages/quay/src/serve-sessions.ts`
- `tasks/gap-routine-semantic-dedup-scan-p015.md`
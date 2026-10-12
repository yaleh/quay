---
id: gap-routine-semantic-dedup-scan-serveheapcapmb-cross-layer-copy
title: "semantic-dedup-scan: two byte-identical bodies including the
  incident-derived magic numbers 4096/512/5 — drifting policy rather than a leaf
  constant — and the 'kernel does not reac"
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
two byte-identical bodies including the incident-derived magic numbers 4096/512/5 — drifting policy rather than a leaf constant — and the 'kernel does not reach into Core' justification is inconsistent with the same file already importing Core's serve-log.ts and systemd-scope.ts; the sanctioned plugin→packages direction means the copy is unnecessary.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791821278116` · ts `2026-10-12T16:07:58.116Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`serveHeapCapMb`、`withServeHeapCap`
- 涉及文件：
- `plugin/scripts/start-drivers.ts:114`
- `plugin/scripts/start-drivers.ts:118`
- `packages/quay/src/cli/server.ts:90`
- `packages/quay/src/cli/server.ts:96`
- kind：`real-duplication`
- verdict：`real-duplication`

## Requested action
merge — start-drivers.ts should import withServeHeapCap from packages/quay/src/cli/server.ts

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `serveheapcapmb-cross-layer-copy`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791821278116`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/start-drivers.ts`
- `packages/quay/src/cli/server.ts`
- `tasks/gap-routine-semantic-dedup-scan-serveheapcapmb-cross-layer-copy.md`
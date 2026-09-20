---
id: gap-routine-semantic-dedup-scan-pidalive-eperm-opposite
title: "semantic-dedup-scan: Three copies treat EPERM as alive
  (exists-but-not-ours) and are byte-identical, but driver-runtime.ts:241
  returns false unconditionally, so the same-named prob"
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
Three copies treat EPERM as alive (exists-but-not-ours) and are byte-identical, but driver-runtime.ts:241 returns false unconditionally, so the same-named probe that gates supervisor restart reads a live-but-foreign pid as DEAD.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789889905875` · ts `2026-09-20T07:38:25.875Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pidAlive`
- 涉及文件：
- `plugin/scripts/driver-runtime.ts:241`
- `packages/quay/src/server-state.ts:172`
- `plugin/scripts/start-drivers.ts:115`
- `plugin/scripts/server-partial-stop-verify.ts:411`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `pidalive-eperm-opposite`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789889905875`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/driver-runtime.ts`
- `packages/quay/src/server-state.ts`
- `plugin/scripts/start-drivers.ts`
- `plugin/scripts/server-partial-stop-verify.ts`
- `tasks/gap-routine-semantic-dedup-scan-pidalive-eperm-opposite.md`
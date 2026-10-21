---
id: gap-routine-architecture-analysis-plugin-scripts-flat-god-directory
title: "architecture-analysis: archguard god-package: plugin/scripts = 299
  top-level .ts, 4466 entities, 189347 lines, fanOut 3163 with fanIn 0 — one
  flat namespace where any script may im"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard god-package: plugin/scripts = 299 top-level .ts, 4466 entities, 189347 lines, fanOut 3163 with fanIn 0 — one flat namespace where any script may import any other, so no structural boundary (cycle ratchet only) separates kernel, drivers, checkers and routines.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792599464308` · ts `2026-10-21T16:17:44.308Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveWorkerProcessName`、`runAutoTightenPass`、`isFinalState`、`readJsonLines`、`readJsonlLines`
- 涉及文件：
- `plugin/scripts/worker-driver.ts:602`
- `plugin/scripts/gate-script-base.ts:434`
- `plugin/scripts/driver-runtime.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Introduce domain subdirectories (drivers/ checkers/ routines/ lib/) with an import-graph allowlist extending the existing import-graph-baseline.json; move incrementally, one domain per task.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `plugin-scripts-flat-god-directory`（routine `architecture-analysis`，runId `architecture-analysis-1792599464308`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/worker-driver.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/driver-runtime.ts`
- `tasks/gap-routine-architecture-analysis-plugin-scripts-flat-god-directory.md`
---
id: gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared
title: "architecture-analysis: Both probes still declare fallback: git-lens and
  name three scripts in plugin/scripts/ that were archived to
  archive/2026-09-07-zero-call-scripts/ and are ab"
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
Both probes still declare fallback: git-lens and name three scripts in plugin/scripts/ that were archived to archive/2026-09-07-zero-call-scripts/ and are absent on disk (verified: all three MISSING), while the specs were edited 2026-09-13 and 2026-10-20 — after the archive — so a run on a host without the archguard MCP follows the declared fallback to MODULE_NOT_FOUND and emits an empty findings array, which this routine records as a genuine 'nothing found' measurement (rule 3b conflation).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793051973088` · ts `2026-10-26T21:59:33.088Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`git-lens-l-d-code-doc-ratio`、`git-lens-l-g-structural-drift`、`git-lens-l-s-behavior-variance`
- 涉及文件：
- `plugin/probes/architecture-analysis.md:31`
- `plugin/probes/architecture-analysis.md:32`
- `plugin/probes/architecture-analysis.md:33`
- `plugin/probes/semantic-dedup-scan.md:40`
- kind：`instrument-drift`
- verdict：`confirmed`

## Requested action
Repoint both probes' fallback block at live readers (phase-declare.ts takeLdFileReading for L_D, archguard-runner.ts readDirectoryCycleReading for L_G, ls-mutation-reading.ts for L_S) or set fallback: none so the driver records not-evaluated; AC = every path named in any plugin/probes/*.md fallback section exists on disk and a fixture run of it exits 0 or 1, never a module-resolution error, checked by one script in the probe routine's pre-spawn check.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T21:59:33.088Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `probe-fallback-instrument-archived-undeclared`（routine `architecture-analysis`，runId `architecture-analysis-1793051973088`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/probes/architecture-analysis.md`
- `plugin/probes/semantic-dedup-scan.md`
- `tasks/gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared.md`
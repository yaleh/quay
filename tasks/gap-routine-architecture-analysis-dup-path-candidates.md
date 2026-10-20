---
id: gap-routine-architecture-analysis-dup-path-candidates
title: "architecture-analysis: Structurally identical 28-line path resolution
  clone (archguard dup hash 4cf914f3bbd40659, 316 tokens) inside two independent
  static checkers, so scope-resol"
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
Structurally identical 28-line path resolution clone (archguard dup hash 4cf914f3bbd40659, 316 tokens) inside two independent static checkers, so scope-resolution semantics can drift between gates.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792481915389` · ts `2026-10-20T07:38:35.389Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pathCandidates`
- 涉及文件：
- `plugin/scripts/threshold-scope-check.ts:162`
- `plugin/scripts/tick-core-static-check.ts:253`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract to a shared plugin/scripts/path-scope.ts consumed by both; AC: repo-wide grep finds one definition and both checkers' existing tests stay green.

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-path-candidates`（routine `architecture-analysis`，runId `architecture-analysis-1792481915389`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/tick-core-static-check.ts`
- `plugin/scripts/path-scope.ts`
- `plugin/test/path-scope-single-source.test.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-architecture-analysis-dup-path-candidates.md`

## Blocker

**2026-10-20T08:04:21.772Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: no live reference to the moved files' old paths may remain (update callers to plugin/loop/ + plugin/scripts/)
- run_id：wk-prod-anchor
- session_id：03cfad1c-c137-4159-a1c9-ec81217e4784

---
id: gap-routine-architecture-analysis-mjs-primitives-outside-both-dependency-graphs
title: "architecture-analysis: The AC-916 guard's walkTs matches only /\\.ts$/
  and import-graph-check's candidate filter is `/\\.(ts|mts|cts)$/`, while 4
  runtime primitives exist as .mjs — s"
status: todo
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
The AC-916 guard's walkTs matches only /\.ts$/ and import-graph-check's candidate filter is `/\.(ts|mts|cts)$/`, while 4 runtime primitives exist as .mjs — session-liveness.mjs and session-schema.mjs are imported by packages/quay/src/observation.ts:67-68, delivery-audit.mjs by packages/quay/src/serve/io/serve-send.ts:53, and session-liveness.mjs crosses the package boundary into plugin/scripts/orphan-session-check.ts:51; measured: walkTs sees 192 files and pty-frame.mjs/3 siblings are absent, matching archguard's own reconciliation 'sourceFiles=192 vs git ls-files=203 (diff -11)' = 4 .mjs + 4 .d.mts + 1 .md + 1 .json + 1 .css. So 'zero directory cycles' is asserted over a graph that omits 4 real modules, and rule 5 applies: a source that is not complete cannot prove absence.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794127547195` · ts `2026-11-08T08:45:47.195Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`walkTs`、`analyzeDirectoryCycles`、`buildGraph`、`readTranscriptMtime`、`validateSessionRecord`
- 涉及文件：
- `packages/quay/test/directory-cycle.test.mjs:62`
- `plugin/scripts/import-graph-check.ts:552`
- `packages/quay/src/primitives/session-liveness.mjs:1`
- `packages/quay/src/primitives/session-schema.mjs:1`
- `packages/quay/src/observation.ts:67`
- `packages/quay/src/serve/io/serve-send.ts:53`
- `plugin/scripts/orphan-session-check.ts:51`
- kind：`coverage-gap`
- verdict：`CONFIRMED coverage gap — no cycle is hidden today, but the invariant does not cover 4 live files`

## Requested action
Widen both walkers to /\.(ts|mts|mjs)$/ (excluding .d.mts/.d.ts) and add a fixture where alpha/index.ts -> primitives/x.mjs -> beta/index.ts must be detected as a cycle.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:45:47.195Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `mjs-primitives-outside-both-dependency-graphs`（routine `architecture-analysis`，runId `architecture-analysis-1794127547195`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/test/directory-cycle.test.mjs`
- `plugin/scripts/import-graph-check.ts`
- `packages/quay/src/primitives/session-liveness.mjs`
- `packages/quay/src/primitives/session-schema.mjs`
- `packages/quay/src/observation.ts`
- `packages/quay/src/serve/io/serve-send.ts`
- `plugin/scripts/orphan-session-check.ts`
- `tasks/gap-routine-architecture-analysis-mjs-primitives-outside-both-dependency-graphs.md`
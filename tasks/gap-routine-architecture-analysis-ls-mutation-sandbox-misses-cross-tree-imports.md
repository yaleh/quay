---
id: gap-routine-architecture-analysis-ls-mutation-sandbox-misses-cross-tree-imports
title: "architecture-analysis: buildSandbox(root,[target,test]) stages only `top
  = rel.split('/')[0]` of the two named paths (one line, :385), so any test that
  imports across a top-level b"
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
buildSandbox(root,[target,test]) stages only `top = rel.split('/')[0]` of the two named paths (one line, :385), so any test that imports across a top-level boundary gets ERR_MODULE_NOT_FOUND and the baseline is classified `load-or-parse-failure` -> exit 3; reproduced: task-transition.test.mjs now imports ../../../plugin/scripts/source-text-lib.ts (added in 08a1b7a04, 2026-10-29) and the run reports NOT-EVALUATED although the unmutated file is green (42/42 for the same pattern on loop-params), while the carrier .quay/ls-readings.jsonl holds exactly one record — target task-transition.ts, mutants=30 killed=26 survived=3 score=0.8966 at 2026-10-22, i.e. the instrument can no longer reproduce its own AC3 reference reading; scope of impact measured: 77 of 344 packages/quay/test/*.mjs (22.4%) import across a top-level boundary (76 via ../../../plugin/, 1 via ../../../experiments/).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794127547195` · ts `2026-11-08T08:45:47.195Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`buildSandbox`、`runTestOnce`、`takeReading`
- 涉及文件：
- `plugin/scripts/ls-mutation-reading.ts:383`
- `plugin/scripts/ls-mutation-reading.ts:385`
- `packages/quay/test/task-transition.test.mjs:36`
- `packages/quay/test/loop-params.test.mjs:1`
- kind：`instrument-defect`
- verdict：`CONFIRMED regression — dated before/after, NOT-EVALUATED since 2026-10-29`

## Requested action
Stage every top-level directory reachable by a relative import from target+test (or copy the tree minus node_modules), and add a fixture test importing ../../../plugin/... asserting a non-null score rather than not-evaluated.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:45:47.195Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `ls-mutation-sandbox-misses-cross-tree-imports`（routine `architecture-analysis`，runId `architecture-analysis-1794127547195`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/ls-mutation-reading.ts`
- `packages/quay/test/task-transition.test.mjs`
- `packages/quay/test/loop-params.test.mjs`
- `tasks/gap-routine-architecture-analysis-ls-mutation-sandbox-misses-cross-tree-imports.md`
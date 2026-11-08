---
id: gap-routine-architecture-analysis-ls-mutation-sandbox-misses-cross-tree-imports
title: "architecture-analysis: buildSandbox(root,[target,test]) stages only `top
  = rel.split('/')[0]` of the two named paths (one line, :385), so any test that
  imports across a top-level b"
status: done
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

## 处置结论（2026-11-08，本任务实跑）

**修掉（不是「已有机制在管」）。** `buildSandbox` 不再只取两个**具名**路径的
`top = rel.split('/')[0]`；新增 `reachableTopLevels(root, seeds)` 沿种子（target + test）的**相对 import
传递闭包**收集顶层条目，沙箱按该集合拷贝。import 抽取复用既有 `extractImports`
（`plugin/scripts/import-graph-check.ts`，按**代码位置**判定、已屏蔽注释/字符串），路径归一复用
`normalizeRelativeSpecifier` —— ⛔ 没有在这里另造一套正则族。

三处刻意选择，都是为了不让「读不懂」重新伪装成「读过了」（硬规则 3b）：
- **过覆盖**：拷整个顶层条目而非单个文件 —— 测试可能在运行期按路径读同目录 fixture，静态扫描看不见。
- **欠覆盖**：未被 reach 到的顶层条目不拷 —— 静态看不见的动态 import 仍然落到诚实的 `not-evaluated`，
  绝不伪造 score。修复**没有**把这个第三态去掉，它只是不再被一个静态可解的情形误触发。
- 逃出 root 的 specifier 解析为 `null`（不可 stage），不是悄悄跳过。

### 修复前（同一命令，`packages/quay/test/task-transition.test.mjs`）
`ls-mutation-reading: NOT-EVALUATED — baseline-not-green: load-or-parse-failure` ⇒ exit 3

### 修复后（同一命令）
`packages/quay/src/kernel/task-transition.ts | mutants=13 killed=12 survived=1 notEvaluated=0 score=0.9231` ⇒ exit 0

新增回归夹具 `plugin/test/fixtures/ls-mutation/cross-tree/`（复刻 `packages/quay/{src,test}` →
`../../../plugin/scripts/*` 的仓形），由 `plugin/test/ls-mutation-reading.test.mjs` 的 AC3(a)(b)(c) 钉住：
(a) CLI 出**非 null score** 且 `notEvaluated=0`、`killed≥1`；(b) staged 集合恰为 `{packages, plugin}` 且
**不含**无人 import 的 `docs`；(c) 越出 root 的 specifier 与 bare specifier 都解析为 `null`。
反向控制已实测：只 stage `packages/` 时该夹具确实 `ERR_MODULE_NOT_FOUND`（status 1）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `ls-mutation-sandbox-misses-cross-tree-imports`（routine `architecture-analysis`，runId `architecture-analysis-1794127547195`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Dark axis (ADR-007)
- L_D import-graph-check(root=worktree): files=563 edges=1753 valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0 verdict=PASS — 本改动新增 `ls-mutation-reading → import-graph-check` 一条 plugin 内部边，未引入环、未越 kernel 边界。
- L_S ls-mutation-reading(task-transition.ts/decideTransition): mutants=13 killed=12 survived=1 notEvaluated=0 score=0.9231 — 仪器修复后第一次重新取到该目标的读数（2026-10-22 的旧读数为 mutants=30 killed=26 survived=3 score=0.8966，函数集不同）。

## Touches
- `plugin/scripts/ls-mutation-reading.ts`
- `plugin/test/ls-mutation-reading.test.mjs`
- `plugin/test/fixtures/ls-mutation/cross-tree/packages/quay/src/target.mjs`
- `plugin/test/fixtures/ls-mutation/cross-tree/packages/quay/test/check-cross-tree.mjs`
- `plugin/test/fixtures/ls-mutation/cross-tree/plugin/scripts/shared.mjs`
- `plugin/test/fixtures/ls-mutation/cross-tree/docs/README.md`
- `packages/quay/test/task-transition.test.mjs`
- `packages/quay/test/loop-params.test.mjs`
- `tasks/gap-routine-architecture-analysis-ls-mutation-sandbox-misses-cross-tree-imports.md`

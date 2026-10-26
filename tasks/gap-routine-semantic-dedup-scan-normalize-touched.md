---
id: gap-routine-semantic-dedup-scan-normalize-touched
title: "semantic-dedup-scan: The two plugin copies are byte-identical (backslash
  to slash, strip leading ./, trim) and the serve copy is the same normalization
  minus trim, re-declared acro"
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
The two plugin copies are byte-identical (backslash to slash, strip leading ./, trim) and the serve copy is the same normalization minus trim, re-declared across the layer boundary.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793051606259` · ts `2026-10-26T21:53:26.259Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`normalizeTouched`、`normalizeFileRef`
- 涉及文件：
- `plugin/scripts/suite-bucket-hub-list.ts:86`
- `plugin/scripts/suite-bucket-select.ts:98`
- `packages/quay/src/serve/feat/serve-tests.ts:444`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract - shared path-ref normalizer leaf; keep trim behavior explicit per caller.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T21:53:26.259Z

## Disposition

**结论：修掉**（不是「已有机制在管」）。复核依据 = `.quay/routine-findings.jsonl:3291` 的原始记录
（`findingId:"normalize-touched"`、`verdict:"real-duplication"`、`files` 恰为上列三处、
`suggestedAction:"extract - shared path-ref normalizer leaf; keep trim behavior explicit per caller."`）。

- 新叶子 `packages/quay/src/kernel/path-ref.ts` → `normalizePathRef`：`\`→`/` + 去前导 `./`，
  ⛔ **不** trim、⛔ 不折叠 `..`、⛔ 不去尾斜杠（这三条是各调用方自己的策略）。
- 落点选 `packages/quay/src/kernel/` 的理由：`packages/**` 静态 import `plugin/**` 是
  `import-graph-check.ts` `reverseEdges`（baseline 0）禁止的反向边 ⇒ 共享实现只能落在两侧都可达的
  Core 叶子（同 `kernel/load-avg.ts` / `kernel/env-merge.ts` / `kernel/regex-escape.ts`）。
- 调用点 5 处（finding 点名 3 + 同谓词兄弟 2）全部改为导入叶子：`suite-bucket-hub-list.ts`、
  `suite-bucket-select.ts`、`serve/feat/serve-tests.ts`、`deletion-closure-check.ts`、
  `suite-bucket-drift-check.ts`。**5 份 body → 1 份**。两个 `normalizeTouched` 与 `normalizeFileRef`
  三个本地符号被删除（不留同义 wrapper，避免同名再分叉）。
- **trim 每调用点显式**：插件侧写 `normalizePathRef(x).trim()`；serve 侧写 `normalizePathRef(x)`
  —— 产物 `.quay/suite-bucket-effective.jsonl` 的 key 未 trim，带空白的 ref 不得命中。
- 判据 `packages/quay/test/kernel-path-ref.test.mjs`（6 条，全绿）：
  ① 生产树中该 body 的精确集合 = `{kernel/path-ref.ts}`，且 trim 变体零命中（硬规则 2 两半都跑）；
  ② 五个调用点全部导入叶子（插件侧跨树、Core 侧 in-package）；
  ③ 契约：不 trim / 不折叠 `..` / 不去尾斜杠；
  ④ trim 差异经**两个公开面**实测 —— `isHubFile("...ts   ")` 为真（插件侧 trim），
     `bucketSetOfFile(" pkg/a.test.mjs", root)` 为空（serve 侧不 trim）；
  ⑤ 两个插件 CLI **真进程**跑通（首轮曾漏 `positional.map(normalizeTouched)` 的模块级引用，
     ②③④ 全绿也看不见这一族）。
  两条红控制实跑后复原：把 trim 变体注回 → ①zero-count 红；把完全同形 body 注入**第六个**文件
  → ①精确集合红并点名该文件。
- 硬规则 5b 枚举（同一载体 `replace(/\\/g, "/")`，plugin+packages+scripts+experiments 共 **18** 命中，
  排除 `dist/`/`node_modules/`/测试；前 3 条：`suite-bucket-select.ts:99`、`suite-bucket-hub-list.ts:87`、
  `serve-tests.ts:445`，均已处置）：已统一 5 处（上）。判为**不同谓词**、有意保留并在此记录：
  `gate-script-base.ts` 的 `normalizeRel`（还折叠空段/`..`、去尾斜杠，且在 plugin 侧、Core 不可达）；
  `driver-filters.ts`(`isDiscardableSurfacePath`) 与 `select-static-checks-for-touches.ts`(`isDocPath`)
  （在本叶子的 key 之上**额外**去尾斜杠）。其余为 backslash-only（无 `./` 规则，不适用本谓词）：
  `known-load-sensitive.ts` / `fan-in-workflow-retirement-check.ts` / `main-thread-edit-check.ts` /
  `precommit-guard.ts` / `state-worded-clause-check.ts` / `tick-core-static-check.ts` /
  `worker-fan-in.ts` / `plugin/test/helpers/fan-in-execute-paths-harness.mjs`。

## ADR-007 dark axis
- L_G：该轴仍暗,理由:本次只做单文件叶子抽取（body 副本 5→1 由 kernel-path-ref.test.mjs 的精确集合判据承担）,本轮未运行 archguard 的 L_G/L_D 读数

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `normalize-touched`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793051606259`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/suite-bucket-hub-list.ts`
- `plugin/scripts/suite-bucket-select.ts`
- `plugin/scripts/deletion-closure-check.ts`
- `plugin/scripts/suite-bucket-drift-check.ts`
- `packages/quay/src/serve/feat/serve-tests.ts`
- `packages/quay/src/kernel/path-ref.ts`
- `packages/quay/test/kernel-path-ref.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-normalize-touched.md`

## Blocker

**2026-10-26T23:33:38.055Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: …BELOW the requested lane count 128 — the scheduler's reliability cap is why [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/fan-in-execute-paths-s06.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：2108e5f4-bf32-4472-b7b9-8b2ffc976635

---
id: gap-routine-semantic-dedup-scan-misc-isdirectentry
title: "semantic-dedup-scan: Three basename-equality copies; precommit-guard and
  the .mjs inline their own name literal instead of calling the parameterised
  shared version (the .mjs one ma"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Three basename-equality copies; precommit-guard and the .mjs inline their own name literal instead of calling the parameterised shared version (the .mjs one may be an import boundary carve-out).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792847536579` · ts `2026-10-24T13:12:16.579Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isDirectEntry`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:744`
- `plugin/scripts/precommit-guard.ts:803`
- `plugin/scripts/workflow-event-schema.mjs:808`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Disposition（复核结论 + 处置）
verdict `real-duplication` **成立**：三处里一处是正本、两处是可消除的私有副本，两处副本已删除。

1. `plugin/scripts/gate-script-base.ts:744` —— **正本**：参数化 `isDirectEntry(importMeta, argv1, expectedBase)`，
   按被调用文件的 basename 判定，`importMeta` 明确不参与身份（bundling-safe）。
2. `plugin/scripts/precommit-guard.ts:803` —— 私有副本，未 import 正本，内联 `"precommit-guard"` 字面量。
   **已删除**，改为 `isDirectEntry(import.meta, process.argv[1], "precommit-guard")`。
3. `plugin/scripts/workflow-event-schema.mjs:808` —— 私有副本。finding 猜它可能是「import 边界豁免」，
   **实测不成立**：同一文件第 29 行本来就 `import { createSelftest } from "./gate-script-base.ts"`，
   跨扩展名 import 早已存在。**已删除**，改为 `isDirectEntry(import.meta, process.argv[1], "workflow-event-schema")`。

⛔ 3 参具名形式是必需的：bare `isDirectEntry(import.meta)` 的 URL 回退在 esbuild 下对每个 inlined 模块都为真、
会劫持 bundle 的 main（`gap-drivers-yml-interval-not-honored-for-routine-kinds`）。
`packages/quay/scripts/build-plugin-dist.mjs` 里「two do define their own」的注释同步改正 ——
它原本会继续为保留副本背书。

**未抽取的邻近项（写明理由，不是「没注意到」）**：`plugin/scripts/candidate-contracts.ts:266` 有一个
**不同标识符** `isDirectEntryFallback()` —— 其注释声明本模块需保持 dependency-free，且额外用
`&& process.argv.includes("--selftest")` 收紧；probe 按 `isDirectEntry` 精确匹配，未把它算作同 symbol。
保留并在此记录，不冒充已消除。

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-24T13:12:16.579Z
- observed: 修复后 `plugin/scripts` 下 `isDirectEntry` 的**定义**只剩 1 处（gate-script-base.ts:744），
  两份副本消失 ⇒ 下一次 scan 的 same-symbol-multi-file 命中数应为 1（单一定义）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `misc-isdirectentry`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792847536579`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
- 复核（finding 点名的三处逐一读过，符号确认）：`grep -rn "isDirectEntry" plugin/scripts/*.ts plugin/scripts/*.mjs`
- 处置后**精确名**定义数：`grep -rnE "function isDirectEntry\(" plugin/scripts/*.ts plugin/scripts/*.mjs`
  → 1 行，仅 `plugin/scripts/gate-script-base.ts:744`
- 两个调用点均走共享正本（3 参具名）：
  - `plugin/scripts/precommit-guard.ts:812` — `if (isDirectEntry(import.meta, process.argv[1], "precommit-guard"))`
  - `plugin/scripts/workflow-event-schema.mjs:805` — `if (isDirectEntry(import.meta, process.argv[1], "workflow-event-schema"))`
- 行为未变：`node --no-warnings plugin/scripts/workflow-event-schema.mjs --selftest` → `SELFTEST: all fixture cases PASS`
  （`experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs` 是到该文件的 symlink，字节同一，AC4 byte-identical 不受影响）
- `node --no-warnings --test plugin/test/workflow-event-schema.test.mjs` → 50 pass / 0 fail
- `node --no-warnings --test --test-name-pattern="AC1 — activeFileIdentityGuards|AC1 — the shipped plugin surface" packages/quay/test/build-plugin-dist.test.mjs` → 2 pass / 0 fail（shipped 面 0 hijack）
- `node --no-warnings --test plugin/test/server-verifier-twin-helpers.test.mjs` → 15 pass / 0 fail
- scoped gate：`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-misc-isdirectentry --allow-thin` → EXIT=0（含 `duplicateCopies=0 ≤ 0` 的重复度棘轮）

## ADR-007
- L_D: isDirectEntry 定义数 plugin/scripts=1（修复前=3 文件；finding misc-isdirectentry），调用点=2 且均走共享正本

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/precommit-guard.ts`
- `plugin/scripts/workflow-event-schema.mjs`
- `packages/quay/scripts/build-plugin-dist.mjs`
- `tasks/gap-routine-semantic-dedup-scan-misc-isdirectentry.md`

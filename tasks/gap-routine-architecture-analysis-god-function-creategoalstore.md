---
id: gap-routine-architecture-analysis-god-function-creategoalstore
title: "architecture-analysis: createGoalStore is a single 1,647-line closure
  factory (lines 1155-2802) with 20 nested declarations inside a
  3,427-line/43-export module — the remainder aft"
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
createGoalStore is a single 1,647-line closure factory (lines 1155-2802) with 20 nested declarations inside a 3,427-line/43-export module — the remainder after the 2026-10-24 extraction of criterion-attribution and goal-staleness.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793251760204` · ts `2026-10-29T05:29:20.204Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createGoalStore`、`toViewModel`、`listWithMalformed`、`checkAchievedFailing`、`checkReverifyScope`
- 涉及文件：
- `packages/quay/src/core/goal-store.ts:1155`
- `packages/quay/src/core/goal-store.ts:2802`
- kind：`god-function`
- verdict：`confirmed`

## Requested action
Extract the factory's sub-surfaces (criterion reads, staleness/achieved checks, ledger+capability gates) into modules createGoalStore composes, targeting <400 lines per module.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T05:29:20.204Z

## Disposition — 复核结论：修掉（Fix），⛔ 不是「已注意到」

复核：finding 描述属实。`createGoalStore` 实测 1,517 行（`core/goal-store.ts` 1155-2671），
内含 20 个嵌套声明，其中 `write()` 一条就占 687 行；staleness/achieved 判定、冻结population 轮转、
台账扫描各自是一整个子系统，却都挤在同一个闭包里。

处置：把 finding 点名的三类子面**逐字搬出**，由工厂**组合**而非**嵌套**（提交 `e0c290b0e`）：

- `core/goal-store-types.ts`（145 行）— 记录形状 + GOAL/AC id 词表
- `core/goal-store-ledger.ts`（183 行）— 有界的 gate 台账扫描（tails + evidence）
- `core/goal-store-criterion-address.ts`（165 行）— 判据在哪棵树上跑
- `core/goal-store-reads.ts`（267 行）— `get` / `list(WithMalformed)` / `activeGoals` / `isGoalAchieved`
- `core/goal-store-checks.ts`（275 行）— I3/I4 staleness、I5 achieved-but-failing、复验域枚举
- `core/goal-store-rotation.ts`（309 行）— 冻结population + `--stale-pass` **判定**
- `core/goal-store-sweep.ts`（256 行）— 有界轮转**步骤**（唯一跑判据的那一半）

`criterion-capability.ts` 收下 `capabilityRefusalAt`（判官与它的组合谓词同址），
三个含 `runAcceptance` 的模块因此不必回头 import 宿主文件。

**读数（真载体，⛔ 非 fixture）**：
- `createGoalStore` 跨度 **1,517 行 → 872 行**（减少 645 行）；剩余大头仍是 `write`（687 行），
  finding 的 Requested action ⛔ 未点名它 ⇒ 记为**未处置的余量**，不是已解决项。
- 每个被抽出的模块 **< 400 行**（最大 309）。
- 运行时导出面 **不变**：模块 53 个值逐一比对（缺 0 / 多 0 / 类型变 0）；
  `createGoalStore(...)` 返回的 15 个动词不变（运行时断言）。
- `import-graph-check`：`valueSccs=0 typeSccs=0 reverseEdges=0` — 拆分是 DAG，没有新环。

判据可核：`packages/quay/test/gap-routine-architecture-analysis-god-function-creategoalstore.test.mjs`
把「已拆分」钉成**在真文件上取数的棘轮**（工厂跨度 ≤900、每个模块 <400、模块必须被 import 而非仅存在），
并先做仪器自检（同一测量须能读出 502 也能读出 3；缺签名返回 null ⇒ `unknown`，⛔ 不是 0）
—— 一条只能读出「小」的测量不携带信息（硬规则 4）。

## ADR-007 dark axis
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0（拆分后仍是 DAG；L_G 本任务未涉及）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-function-createGoalStore`（routine `architecture-analysis`，runId `architecture-analysis-1793251760204`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/core/goal-store.ts`
- `packages/quay/src/core/goal-store-types.ts`
- `packages/quay/src/core/goal-store-ledger.ts`
- `packages/quay/src/core/goal-store-criterion-address.ts`
- `packages/quay/src/core/goal-store-reads.ts`
- `packages/quay/src/core/goal-store-checks.ts`
- `packages/quay/src/core/goal-store-rotation.ts`
- `packages/quay/src/core/goal-store-sweep.ts`
- `packages/quay/src/core/criterion-capability.ts`
- `packages/quay/test/goal-store.test.mjs`
- `packages/quay/test/gap-routine-architecture-analysis-god-function-creategoalstore.test.mjs`
- `tasks/gap-routine-architecture-analysis-god-function-creategoalstore.md`
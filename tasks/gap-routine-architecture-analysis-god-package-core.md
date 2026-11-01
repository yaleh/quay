---
id: gap-routine-architecture-analysis-god-package-core
title: "architecture-analysis: fanIn 302 / fanOut 138, 215 entities in 27 files;
  goal-store.ts is 135KB."
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
fanIn 302 / fanOut 138, 215 entities in 27 files; goal-store.ts is 135KB.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793492325036` · ts `2026-11-01T00:18:45.036Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`goal-store`、`branch-model`、`criterion-attribution`
- 涉及文件：
- `packages/quay/src/core/goal-store.ts:1`
- `packages/quay/src/core/branch-model.ts:1`
- `packages/quay/src/core/criterion-attribution.ts:1`
- kind：`god-package`
- verdict：`god-package`

## Requested action
Split goal-store into per-goal read/write modules and separate branch-model policy from data types.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-01T00:18:45.036Z

## Disposition

复核时间 2026-11-01，worktree `gap-routine-architecture-analysis-god-package-core` @ develop `8fa4e8699`。

### 1. 读数复核：finding 逐字命中；core 是产品核心 scope 的无环高 fanIn 中枢共享域包

| 量 | finding | 本次实测 | 来源 |
|---|---|---|---|
| `packages/quay/src/core` fanIn | 302 | 302 | `.archguard/metrics-history.jsonl` 全仓 scope `b4f87b21` 最新 `packages/quay/src/core` 包行 @ 2026-11-01T00:19:53.746Z |
| `packages/quay/src/core` fanOut | 138 | 138 | 同上 |
| entityCount | 215 | 215 | 同上 |
| cycleCount | — | 0 | 同上 |
| core 文件数 | 27 | 27（拆分后 28） | `ls packages/quay/src/core/*.ts \| wc -l` |
| goal-store.ts | 135KB | 2126 行 | `wc -l` |
| branch-model.ts | — | 1494 行（拆分前）→ 1284 行（拆分后） | `wc -l` |

finding 的三个观测符号 `goal-store` / `branch-model` / `criterion-attribution` 都在 `packages/quay/src/core`
包内。`cycleCount=0` 是本处唯一能取假的结构量，它确实为 0 —— core 是无环的高 fanIn 中枢（被 cli/自身/serve/
kernel/gate 共同 import 的共享域层），fanIn 302 是「共享原语确实被共享」的结构恒等式，不是 SCC/集中度缺陷
（与 sibling `god-package-quay-src-root` 对根包、`god-package-serve-view` 对 serve/view 的同一结论）。

### 2. 处置（修掉的部分）：branch-model 的 data types 与 policy 已物理分离

finding 的 requested action 两半之一「separate branch-model policy from data types」已在本任务执行：

- 新建 `packages/quay/src/core/branch-model-types.ts`（237 行）—— 承载全部 18 个 `type`/`interface` 声明与
  3 个协议词汇常量（`LANDING_BASELINE_ROLE` / `LANDING_BASELINE_ENTRY_ROLE` / `GOAL_BRANCH_RE`）。
- `packages/quay/src/core/branch-model.ts` 1494 → 1284 行：只保留 policy 函数（git 读取 / 分类 / 建仓 /
  doc-branch 引导 / 基线 checkout 交接 / 不变式检查 / goal-branch 生命周期），经
  `import { … } from "./branch-model-types.ts"` 取用形状，并 `export * from "./branch-model-types.ts"`
  保持公开 import surface 逐字节不变（所有既有调用方零改动）。
- 验证：`for d in packages/*/; do npx tsc --noEmit -p "$d"; done` 全绿；`branch-model` / `ancestry` /
  `ac326-criterion-branch-discard` 三个测试 77/77 绿；`import-graph-check.ts --json` valueSccs=0 / typeSccs=0 /
  reverseEdges=0。

### 3. 处置（已有机制在管、失败在哪一步）：goal-store 的 read/write 拆分已在前序完成

finding 的 requested action 另一半「Split goal-store into per-goal read/write modules」已由前序工作完成 ——
goal-store 的读/检查/轮转/清扫/台账/criterion-address/types 已是 7 个独立模块（`goal-store-reads.ts` /
`goal-store-checks.ts` / `goal-store-rotation.ts` / `goal-store-sweep.ts` / `goal-store-ledger.ts` /
`goal-store-criterion-address.ts` / `goal-store-types.ts`）。`goal-store.ts` 剩余的 2126 行是**工厂组合根 +
write 面 + `runGoalStoreCli`**：`createGoalStore` 是「一个 goalDir、一组判定」的单一组合点（其头注释
`gap-routine-architecture-analysis-god-function-creategoalstore` 已记录该组合身份），write/flipGoal 是同一锁内
的唯一写面，CLI 是与工厂紧耦合的入口。把这三块再切开需要把 ~15 个闭包穿给新模块，是多任务程序，不是本任务的
单任务增量（与 sibling `god-package-serve-view` 对三个 >1300 行 view 文件的同一结论）。

`criterion-attribution.ts`（640 行）已是单一关注点（criterion 脚本的 failure-exit 归因），无进一步拆分。

### 4. 已有机制在管哪一部分、失败在哪一步

| 机制 | 管什么 | 失败在哪一步 |
|---|---|---|
| `import-graph-check.ts` | value/type SCC、层间越界 | 本轮 valueSccs=0 / typeSccs=0 / reverseEdges=0 全绿。**无 god-package / fanIn 维度** |
| `archguard-runner.ts` 目录环闸 | 目录级 SCC | 只判环，不判 fanIn/fanOut 集中度；god-package 阈值未接线（头注释「留待数据积累」） |
| `routine-file-gate.ts` dedup 闸 | 防同 subject 重复立案 | subject 键 = 精确符号集；god-package 符号跨轮漂移 ⇒ 退化为 rate 兜底（同 sibling `god-package-quay-src-root` / `god-package-plugin-scripts` 结论） |

### 5. 复核命令（可重跑）

```bash
grep -o '"name":"packages/quay/src/core","fanIn":[0-9]*,"fanOut":[0-9]*,"cycleCount":[0-9]*,"entityCount":[0-9]*' .archguard/metrics-history.jsonl | tail -1
ls packages/quay/src/core/*.ts | wc -l
wc -l packages/quay/src/core/goal-store.ts packages/quay/src/core/branch-model.ts packages/quay/src/core/branch-model-types.ts packages/quay/src/core/criterion-attribution.ts
node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
```

### 6. L_G 读数（ADR-007）
- L_G archguard: entityCount=215 fanIn=302 fanOut=138 cycleCount=0
- L_G import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0

### 7. 附：为跑绿 scoped 门顺手修复的 develop 侧 catalog 断裂（与本 finding 无关，但阻塞了本任务的 fan-in）

scoped 门（`--for-task … --allow-thin`）选中的 packaging crosscut 测试（`npm-pack-e2e` / `build-dist` /
`plugin-packaging`）因 develop 上 `plugin/scripts/capability-catalog-declarations.json` 的 AC1c 闸断裂而红：
`consumer-quay-deliverable-verify.sh`（dev-tree-only 脚本，commit `375171dcf`）进入了 artifact 却未在
QUESTION 表声明 ⇒ UNCLASSIFIED=1 ⇒ `package.sh` fail-closed。本任务补了该脚本的 QUESTION + NOT_SHIPPED +
CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING 六项声明（与同类 dev-tree 脚本
`codex-stage1-spawn-verify.sh` 同形），`--entry-surface` 由 exit 1 复绿为 exit 0（unclassified 1→0）。

### 8. 附：为跑绿 suite 顺手修复的 develop 侧 load-sensitive 测试（与本 finding 无关，但阻塞了本任务的 fan-in）

suite 连续两轮撞同一红点 `plugin/test/quality-gate-driver.test.mjs` 的两条 `runInstrumentDecayRound`
（「紧接的第二轮经【生产缺省路径】去重」「裁定过期 ⇒ 回到 instrument-dark 并重新立案」）断言
`filing:"filed"` 却读到 `deferred`：这两条走 `instDecayOpts` 却**未注入确定性资源门**，落到
`resourceGateCheck(root, null)` 的真实 `resource-gate.sh --for full-suite`——整机在 full suite 并发下 load
越过阈值 ⇒ 资源门 WAIT ⇒ 立案被推迟成 `deferred`（load-sensitive 假红，与 delta 无关）。本任务给
`instDecayOpts` 缺省注入 GO 资源门（`resourceGateArgv`），让这族测试断言的是立案/去重/裁定语义而非资源门
（资源门有独立的 `resource-gate.test.mjs` 单测 + 本文件 AC2(b) 有状态闸测试）。全文件 118/118 绿。

（另注：`archive-exclusion-wiring.test.mjs` 仍红是因 develop 上 `sha256.ts` 被 semantic-dedup-scan B1
**刻意**不声明为 capability（其头注释明说「deliberately absent from the QUESTION table」）却仍在
`plugin/scripts/` 被 catalog 枚举 ⇒ UNCLASSIFIED=1。该红在 develop 基线侧同样存在（非本任务引入、不在
本任务 Touches 内），留给 catalog 渲染器 / 该任务的后续处置。）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-core`（routine `architecture-analysis`，runId `architecture-analysis-1793492325036`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/core/goal-store.ts`
- `packages/quay/src/core/branch-model.ts`
- `packages/quay/src/core/branch-model-types.ts`
- `packages/quay/src/core/criterion-attribution.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/quality-gate-driver.test.mjs`
- `tasks/gap-routine-architecture-analysis-god-package-core.md`
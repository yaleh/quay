---
id: gap-routine-architecture-analysis-god-module-goal-store
title: "architecture-analysis: 4,167 lines / 64 exports / 34 importers in one
  module (archguard: quay/src/core fanIn 221) carrying at least five separable
  jobs — criterion-root/tree resolu"
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
4,167 lines / 64 exports / 34 importers in one module (archguard: quay/src/core fanIn 221) carrying at least five separable jobs — criterion-root/tree resolution (L130-367), frozen-population rotation (L368-690), bounded ledger scan + staleness signal (L513-921), the implicit-exit and errexit-abort shell-statement parsers (L1117-1730), and M1 time columns + CLI wiring (L1733-3600).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792752934532` · ts `2026-10-23T10:55:34.532Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createGoalStore`、`evaluateCriterionAttribution`、`resolveGoalStaleness`、`readGoalConfig`、`resolveCriterionRoot`、`runGoalStoreCli`
- 涉及文件：
- `packages/quay/src/core/goal-store.ts:1`
- `packages/quay/src/core/goal-store.ts:1117`
- `packages/quay/src/core/goal-store.ts:1529`
- kind：`god-module`
- verdict：`confirmed`

## Requested action
Split the criterion-attribution parsers (L1117-1730) into core/criterion-attribution.ts and the staleness signal into core/goal-staleness.ts, keeping goal-store.ts as the store + CLI surface.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:55:34.532Z

## Disposition（处置结论，可核）

**已修 —— 不是「已注意到」。** 复核载体记录：`.quay/routine-findings.jsonl` 里 runId
`architecture-analysis-1792752934532` 有两条（`kind:finding` verdict=confirmed、`kind:filing-round`），
finding 内容与任务体 `## Finding` 逐字一致 ⇒ 观测对象存在且属实。

按 Requested action 把两处自包含职责**逐字**搬出（`git show develop:…` 与搬迁后的正文逐段对照，无改写）：

| 新模块 | 内容 | 规模 |
|---|---|---|
| `packages/quay/src/core/criterion-attribution.ts` | 原 L1117-1731：implicit-exit / errexit-abort / trailing-computed 三类 parser + `evaluateCriterionAttribution` 三态判据 + `formatBareFailureExits`。**零 import**（纯 string→值），所以两个消费面之间结构上不可能再各写一份 | 640 行 |
| `packages/quay/src/core/goal-staleness.ts` | 原 L726-907：`.quay/goal-staleness-signal.jsonl` 的 append / resolve / 三态 fold（`readGoalStalenessIndex` 现由 store 侧列表路径 import） | 204 行 |

`packages/quay/src/core/goal-store.ts` 保留 **store + CLI 面**：4167 → 3412 行。两处旧址各留一个
**forwarding re-export**（⛔ 不是复制），因此历史 import 面 `packages/quay/test/*`、`quay-native/src/goal-store.ts`、
`plugin/scripts/criterion-failure-attribution-check.ts` 的名与身份都不变；`goalStatusOf`（读本 store 的记录文件）
刻意**留在 store**，使 staleness 模块保持零记录存储依赖的叶子。

读数（本任务提交上实测，非引用）：

- L_D: valueSccs=0 typeSccs=0 reverseEdges=0 files=506 edges=1508（`plugin/scripts/import-graph-check.ts`，exit 0，PASS）
- L_G: goalStoreLines=3412 before=4167 extractedLeafModules=2 runtimeExportsBefore=53 runtimeExportsAfter=53
  （旧/新 namespace 逐键 diff：`LOST=[]`、`ADDED=[]` ⇒ 对外值导出集未变；finding 里的「64 exports」含 11 个类型导出）

验证实跑：

- `tsc --noEmit`（根，all packages）exit 0；`tsc --noEmit -p packages/quay` exit 0。
- `plugin/test/criterion-failure-attribution-check.test.mjs` + `goal-store-write-gate-criterion-attribution.test.mjs`
  + `gap-goal-status-stale-achieved-after-new-active-criterion-filed.test.mjs`：**61/61 pass**，其中 C1
  「the ratchet re-exports the SAME predicate — identity, not a copy」仍绿（`checker.X === goalStore.X`）。
- `errexit-abort-silent-exits-zero` / `frozen-population-bare-failure-exits-zero` / `active-ac-must-have-criterion`：15/15 pass。

## 落地阻塞（develop-wide，⛔ 非本 delta；未写 scoped-gate 缓存）

`bash scripts/test.sh --for-task gap-routine-architecture-analysis-god-module-goal-store --allow-thin` 选 8 个文件、189 个用例，
唯一红点是 `packages/quay/test/goal-store.test.mjs` 的「能力闸 AC8(生产面)」：3 条 `not-evaluated`
（`goals/AC-920/922/924` 的 criterion 引用尚不存在的 `plugin/test/unencapsulated-state-admission.test.mjs`）。

- **负控制（硬规则 4 推论四）**：在 pristine `develop`（0f9616be0）的 detached worktree 上跑同一文件同一断言，
  同样红、同样 3 条 ⇒ 与本任务 delta 无关。
- owner = `gap-unencapsulated-state-clue-judge-e2e`（`status: todo`，`depends_on: gap-semantic-admission-contract-module`）；
  它的交付物（线索器 / 判断器 / 契约 / e2e 测试）**不在**本任务 `## Touches` 内，代做即越界且会让 goals/AC-920 假绿。
- ⇒ 本轮 scoped 门是**红**的，因此**没有**写 `.quay/scoped-gate-cache.json`（缓存只记绿；写绿即为伪证）。
  待 owner 落地后重跑本轮即可转绿。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-module-goal-store`（routine `architecture-analysis`，runId `architecture-analysis-1792752934532`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/core/goal-store.ts`
- `packages/quay/src/core/criterion-attribution.ts`
- `packages/quay/src/core/goal-staleness.ts`
- `plugin/scripts/criterion-failure-attribution-check.ts`
- `tasks/gap-routine-architecture-analysis-god-module-goal-store.md`

## Blocker

**2026-10-23T12:54:53.094Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=scoped-gate: TOUCHES-DIR-GLOB-HINT: 1 directory-level tasks/*.md glob(s) — enumerate concrete files or add（已知全局锁）(hint only, not a violation)
✖ 能力闸 AC8(生产面) — 本仓库真 goals 树零误报：这把闸不是无差别拒绝 (45.857452ms)
ℹ fail 1
✖ failing tests:
✖ 能力闸 AC8(生产面) — 本仓库真 goals 树零误报：这把闸不是无差别拒绝 (45.857452ms)
  AssertionError [ERR_ASSERTION]: 3 条现存判据被误判为非只读 —— 这把闸在生产上会开始拒绝真判据
    actual: [ `AC-920-unencapsulated-state-端到端跑通-线索器只产-candidate-判断器拒绝-memoized-误报.md: not-evaluated [{"rule":"uncertifiable-executed-artifact","detail":"plugin/test/unencapsulated-state-admission.test.mjs","proof":"does not resolve under the criterion's cwd, so its capability cannot be established (and the interpreter would report its absence as a plain failure, ⛔ not as not-evaluated)"}]`, `AC-922-ac-920-的端到端判据取-node-test-自身的退出码-不让-tail-吞掉失败.md: not-evaluated [{"rule":"uncertifiable-executed-artifact","detail":"plugin/test/unencapsulated-state-admission.test.mjs","proof":"does not resolve under the criterion's cwd, so its capability cannot be established (and the interpreter would report its absence as a plain failure, ⛔ not as not-evaluated)"}]`, `AC-924-unencapsulated-state-端到端跑通-线索器对真实仓库只产-candidate-从不写-confirme.md: not-evaluated [{"rule":"uncertifiable-executed-artifact","detail":"plugin/test/unencapsulated-state-admission.test.mjs","proof":"does not resolve under the criterion's cwd, so its capability cannot be established (and the interpreter would report its absence as a plain failure, ⛔ not as not-evaluated)"}]` ],
    expected: [],
- run_id：wk-prod-anchor
- session_id：aba7da44-dff7-4cf0-b66c-24e2b1a1a75d

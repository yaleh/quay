---
id: gap-routine-architecture-analysis-workflow-replay-stage-order-predicates
title: "architecture-analysis: Four methods share one body shape —
  findIndex(stageA), findIndex(stageB), two -1 guards, one index comparison —
  differing only in stage names and comparison "
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
Four methods share one body shape — findIndex(stageA), findIndex(stageB), two -1 guards, one index comparison — differing only in stage names and comparison direction (archguard groups them as two structural clones at 202 and 106 tokens).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793162787359` · ts `2026-10-28T04:46:27.359Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`auditAfterNullBuild`、`verifyBeforePrepared`、`auditCompletesBeforeLand`、`gateRunsAfterAudit`
- 涉及文件：
- `plugin/scripts/workflow-replay.ts:156`
- `plugin/scripts/workflow-replay.ts:161`
- `plugin/scripts/workflow-replay.ts:182`
- `plugin/scripts/workflow-replay.ts:187`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Replace with one stageOrder(events, a, b, 'before'|'after') helper so a new ordering invariant cannot silently inherit a copied direction bug.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:46:27.359Z

## Disposition（复核与处置：已修掉，⛔ 不是「已注意到」）

**处置：修掉。** `plugin/scripts/workflow-replay.ts` 新增唯一助手
`stageOrder(events, a, b, relation: "before" | "after")`（放在 `PREDICATES` 之前，`workflow-replay.ts:46-57`），
五个同形谓词全部改为一行委派：

| 谓词 | 委派 | 关系 |
|---|---|---|
| `stageOrderedBefore`（第六个同形实例，5b 一并收编）| `stageOrder(events, A, B, "before")` | A before B |
| `auditAfterNullBuild` | `stageOrder(events, "Audit", "Build", "after")` | Audit after Build |
| `verifyBeforePrepared` | `stageOrder(events, "Verify", "Prepared", "before")` | Verify before Prepared |
| `auditCompletesBeforeLand` | `stageOrder(events, "Audit", "Land", "before")` | Audit before Land |
| `gateRunsAfterAudit` | `stageOrder(events, "Gate", "Audit", "after")` | Gate after Audit |

**计数（硬规则 5b：同一载体内其它适用点）**：`grep -rn 'findIndex(e => e.stage ===' --include=*.ts --include=*.mjs plugin/ packages/ experiments/`（排除 node_modules/dist）
修前 5 处两段式 findIndex 对 + 5 处 -1 守卫；修后剩 **2 处命中**，其中只有 1 处在助手内
（`workflow-replay.ts:52`），另一处 `workflow-replay.ts:184`（`noBuildAfterPreparedFailure`）是**单阶段 + outcome 谓词**，
不是"比较两个 stage 先后"的形状，不在本 finding 的射程内。**两段式排序判定：5 → 1。**

**行为不变（refactor 的判据）**：`node --experimental-strip-types plugin/scripts/workflow-replay.ts`
对 10 个 fixture 的完整输出，修前/修后**逐行相同**（diff 为空，仅 node 警告行的 pid 不同）。

**为什么"没有方向 bug"这件事本身现在可测**：签入 fixture 里**每一条**排序断言的 `expected` 都是 `true`，
即只走通过的那一侧 —— 助手把复制体收了，但每个调用点仍要手写 (主体, 客体, 方向) 三元组，
而这正是本次修 bug 的形态。本任务因此在 `plugin/test/workflow-replay.test.mjs` 加了
`ordering predicates — call-site direction`：五个谓词各跑三种配置 ——
① 它断言的顺序（必须 pass）② 反过来的顺序（必须 fail 且 detail 点名被违反的关系）
③ 缺一个 stage（必须报 `stage "X" not found`，⛔ 不与"未排序"同形，硬规则 3b）。
**负控制已实跑**：把 `gateRunsAfterAudit` 的调用点翻成 `("Audit","Gate","after")` 后，
`scripts/test.sh plugin/test/workflow-replay.test.mjs` 报 **5 个失败**（含两条新增臂）；还原后 36/36 绿。

## Acceptance Criteria
- [x] `.quay/routine-findings.jsonl` 中 finding `workflow-replay-stage-order-predicates`（routine `architecture-analysis`，runId `architecture-analysis-1793162787359`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## Definition of Done
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## 暗轴记录（ADR-007）
- L_G archguard-runner: cycles=0 scopes_evaluated=6/6 entity_scc=0 directory_cycles=0 exit=0
- L_D phase-declare: docLines=0 codeLines=100 ratio=0.000 verdict=PASS exit=0（numstat = `git diff --numstat develop HEAD`，2 文件 +83/-17）
- 说明：本任务是纯去重 refactor，L_D/L_G 两轴在本改动上均**非暗**（都取到了可假读数）；L_G 零环不因本改动改变，属"读数非暗"而非"本改动改善"。

## Touches
- `plugin/scripts/workflow-replay.ts`
- `plugin/test/workflow-replay.test.mjs`
- `tasks/gap-routine-architecture-analysis-workflow-replay-stage-order-predicates.md`

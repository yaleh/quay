---
id: gap-routine-semantic-dedup-scan-median-empty-policy-diverged
title: "semantic-dedup-scan: Same even-average core but the empty-set reading
  diverges: 0 (fast-mode-telemetry, workflow-baseline-metrics) vs null
  (resource-anomaly-detector, which also pr"
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
Same even-average core but the empty-set reading diverges: 0 (fast-mode-telemetry, workflow-baseline-metrics) vs null (resource-anomaly-detector, which also pre-filters non-finite) vs NaN (rework-predictors), and crystallization-half-life rounds to 1 decimal — a missing-vs-zero conflation (硬规则 6).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792168649663` · ts `2026-10-16T16:37:29.663Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`median`
- 涉及文件：
- `plugin/scripts/crystallization-half-life.ts:806`
- `plugin/scripts/fast-mode-telemetry.ts:1367`
- `plugin/scripts/resource-anomaly-detector.ts:172`
- `plugin/scripts/rework-predictors.ts:272`
- `plugin/scripts/workflow-baseline-metrics.ts:109`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

## Requested action
merge — one median with an explicit empty policy

**处置（2026-10-17，由派发链 worker 执行；⛔ 非例程代跑）**：**已修**。六份 `median` 合并成唯一一份
`plugin/scripts/median.ts`：空样本 ⇒ `null`（未测，独占取值，⛔ 不与「测到 0」同形 —— 硬规则 3b/6），
非有限值剔除，排序在函数内部，⛔ 不做舍入。六个消费者 import 它；需要 `number` 的调用点**各自**
显式选哨兵（`?? 0` / `?? Number.NaN`），`crystallization-half-life.ts` 的 1 位小数**展示**舍入留在它
自己的调用点（对其整数 `intervalDays` 是恒等变换）。

5b 扫查：除 finding 列出的 5 个文件外，同核声明还有第 6 处 —— `plugin/scripts/psi-failure-correlation-check.ts:329`
的 `median(sorted) = pct(sorted, 0.5)`（n ≥ 2 时与偶平均核逐字同值，空样本答 `NaN`），已一并合并。
`plugin/scripts/task-granularity-advice.ts` 早已 `import { median as sharedMedian }` 自 rework-predictors，
经 re-export 继续工作（其字段类型本就是 `number | null`）。

**处置结论可核（⛔ 不以「已注意到」结案）**：`node --test plugin/test/median-ssot.test.mjs` ——
② 断言 `plugin/scripts` + `packages/quay/src` 内 `median` 的**声明点恰为一处**（leaves `plugin/scripts/median.ts`），
③ 断言六个消费者 `import` 而非声明，⑤ 行为 oracle（含「空样本」与「测到的 0」必须**可区分**那一对），
⑦ 断言六段被删的旧实现体不再出现；把任一本地副本贴回去，②③ 立即转红（**负控已实跑**：
`fast-mode-telemetry.ts` 贴回一份 `function median` ⇒ ②③④ red，复原后全绿）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `median-empty-policy-diverged`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792168649663`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/crystallization-half-life.ts`
- `plugin/scripts/fast-mode-telemetry.ts`
- `plugin/scripts/resource-anomaly-detector.ts`
- `plugin/scripts/rework-predictors.ts`
- `plugin/scripts/workflow-baseline-metrics.ts`
- `plugin/scripts/psi-failure-correlation-check.ts`
- `plugin/scripts/median.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/median-ssot.test.mjs`
- `plugin/test/rework-predictors.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-median-empty-policy-diverged.md`
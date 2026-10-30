---
id: gap-routine-semantic-dedup-scan-sync-sleep-atomics
title: "semantic-dedup-scan: Exact Atomics.wait sync-sleep re-implemented in
  three plugin scripts plus goal-preview.ts with no shared accessor
  (process-kill-lib.ts carries another inline c"
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
Exact Atomics.wait sync-sleep re-implemented in three plugin scripts plus goal-preview.ts with no shared accessor (process-kill-lib.ts carries another inline copy).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793401709530` · ts `2026-10-30T23:08:29.530Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`_syncSleepMs`、`sleepSync`
- 涉及文件：
- `plugin/scripts/prepare-admission-check.ts:127`
- `plugin/scripts/proposal-convergence.ts:1854`
- `plugin/scripts/sh-census-check.ts:422`
- `packages/quay/src/goal-preview.ts:556`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T23:08:29.530Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `sync-sleep-atomics`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793401709530`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
复核结论 = 真实重复（verdict `real-duplication` 核实无误），处置 = **extract**，单一实现落在
`packages/quay/src/kernel/sync-sleep.ts`（kernel 叶，零 import —— `packages/**` → `plugin/**` 反向边
与 plugin→kernel 正向边各归其位，⛔ 不把实现放回 methodology 侧）：

- 新增 `export function syncSleep(ms)`：`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)` 只此一处。
- 五处字节相同体全部改为 import 该叶并调用 `syncSleep`：
  - `plugin/scripts/prepare-admission-check.ts`（原 `_syncSleepMs`）
  - `plugin/scripts/proposal-convergence.ts`（原 `_syncSleepMs`）
  - `plugin/scripts/sh-census-check.ts`（原 `sleepSync`）
  - `packages/quay/src/goal-preview.ts`（原 `sleepSync`）
  - `plugin/scripts/process-kill-lib.ts`（原内联体，无函数名）
- 复核判据（可核，非声明）：`grep -rn "Atomics.wait(new Int32Array(new SharedArrayBuffer(4))" <五文件>` → 0 命中；
  该 body 在扫描面（`plugin/scripts/` + `packages/*/src/`）上唯一实现点 = `sync-sleep.ts:52`。
  （`supervisor-preempt-candidates.ts` 仍有一处带 `if (ms > 0)` 守卫的同族变体与一处 `graceMs` 变体，属
  本 finding 未点名的兄弟实例，⛔ 不声称已收敛全家族 —— 详见本叶头注释的 SCOPE 边界。）

实跑：
- `node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json` → EXIT=0：
  valueSccs=0 / typeSccs=0 / reverseEdges=0 / kernelViolations=0 / gateLayerViolations=0
  （files=536 edges=1643，含新增叶与 5 条 import 边 —— 抽取未引入任何依赖环或反向边）。

## ADR-007 暗轴记录
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0 gateLayerViolations=0 files=536 edges=1643（worktree 实跑 `node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json`，EXIT=0）
- L_G：该轴仍暗,理由:本任务为字节相同函数体的去重抽取，未对重复/再造抽象跑 archguard detect_duplicates 读数；抽取的「家族收敛」由本 finding 自身的 concept_recurs_after_merge 指标在 merge 后回读，不在本任务内自证。

## Touches
- `plugin/scripts/prepare-admission-check.ts`
- `plugin/scripts/proposal-convergence.ts`
- `plugin/scripts/sh-census-check.ts`
- `packages/quay/src/goal-preview.ts`
- `plugin/scripts/process-kill-lib.ts`
- `packages/quay/src/kernel/sync-sleep.ts`
- `tasks/gap-routine-semantic-dedup-scan-sync-sleep-atomics.md`
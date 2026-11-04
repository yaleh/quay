---
id: gap-routine-semantic-dedup-scan-dist-stats
title: "semantic-dedup-scan: Byte-identical dist(xs:number[]):Dist percentile
  summary (n/min/median/p90/max/mean)."
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
Byte-identical dist(xs:number[]):Dist percentile summary (n/min/median/p90/max/mean).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793780123988` · ts `2026-11-04T08:15:23.988Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`dist`
- 涉及文件：
- `plugin/scripts/duration-report.ts:219`
- `plugin/scripts/fan-in-queueing-model.ts:113`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T08:15:23.988Z

## Disposition
**已修掉（extract），不是「已注意到」。** finding `dist-stats` 报的两个 byte-identical body 现收敛为一个定义：

- 新落点：`plugin/scripts/dist-stats.ts` —— 本 cluster（字符串哨兵 `NOT-EVALUATED` 的 `dist`/`percentile`/`Dist`/`MaybeNum`）的唯一声明处。
- `plugin/scripts/duration-report.ts` 与 `plugin/scripts/fan-in-queueing-model.ts` 都改为 import + re-export 同一个 leaf ⇒ 两个消费者拿到的是**同一个函数对象**（identity），不再各维护一份 byte-identical 拷贝。
- 空样本策略只在 leaf 说一次：空样本 ⇒ `n=0` 且 min/median/p90/max/mean 全部 `NOT-EVALUATED`（⛔ 不是 0 / null / NaN）。`0` 只可能是量出来的 0（硬规则 6）。

**可核证据（本轮实跑）**：
- `node --no-warnings --experimental-strip-types --test plugin/test/dist-stats-ssot.test.mjs` → 8/8 pass；其中 ② 断言 leaf 声明本 cluster、③ 断言两个消费者只 import 不再 declare、④ 断言两消费者与 leaf 是同一函数对象、⑤ 行为 oracle 钉住空样本策略、⑥ 断言两个消费者不再携带 leaf 的 byte-identical body 行。
- `node --no-warnings --experimental-strip-types --test plugin/test/duration-report.test.mjs plugin/test/fan-in-queueing-model.test.mjs` → 31/31 pass；`plugin/test/touches-relax-ledger.test.mjs plugin/test/touches-relax-auto-tighten.test.mjs` → 18/18 pass。
- `node --no-warnings --experimental-strip-types --test plugin/test/capability-catalog.test.mjs` → 18/18 pass（新 leaf 已登记进 catalog，`--summary` 自报 412 scripts | 412 declared | 0 unclassified，EXIT=0）。
- 复核判据（可核，非声明）：finding 记录的两个位置已消失——对 `plugin/scripts/duration-report.ts` 与 `plugin/scripts/fan-in-queueing-model.ts` 跑 grep（`export function (dist|percentile)\b`、`export interface Dist\b`、`export const NOT_EVALUATED\b`、`export type MaybeNum\b`）→ **0 命中**；本 cluster 的声明只在 `plugin/scripts/dist-stats.ts`（dist / percentile / Dist / MaybeNum / NOT_EVALUATED 各 1 处）。
- 落地提交：`3ff20663d`（worktree `task/gap-routine-semantic-dedup-scan-dist-stats`）。

**5b 边界（修好一处 ≠ 只在一处，写明而非沉默略过）**：`defect-latency-pair.ts` 自带同形不同策的 `dist`/`percentile`（空样本用 `null` 而非字符串哨兵），那是独立的 rate-gated finding `percentile-duplicate` / `percentile-conventions-diverged`，本任务只收敛字符串哨兵这一对，未扩大范围。`plugin/scripts/` 内其余同名 `NOT_EVALUATED` 是 exit-code 哨兵（finding `sentinel-not-evaluated-names`），属另一个 finding，同样不在本任务 Touches。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dist-stats`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793780123988`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 暗轴记录
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0 gateLayerViolations=0 files=555 edges=1711（worktree 实跑 `node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts . --json`，EXIT=0）
- L_G：该轴仍暗,理由:本任务为字节相同函数体的去重抽取（dist/percentile 两副本收敛到新 leaf dist-stats.ts），未跑 archguard detect_duplicates 读数；抽取的「家族收敛」由本 finding 自身的 concept_recurs_after_merge 指标在 merge 后回读，不在本任务内自证。

## Touches
- `plugin/scripts/duration-report.ts`
- `plugin/scripts/fan-in-queueing-model.ts`
- `plugin/scripts/dist-stats.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/dist-stats-ssot.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-dist-stats.md`
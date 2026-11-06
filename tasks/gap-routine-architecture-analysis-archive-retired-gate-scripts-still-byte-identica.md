---
id: gap-routine-architecture-analysis-archive-retired-gate-scripts-still-byte-identica
title: "architecture-analysis: md5 comparison run today: drain-scheduler.ts
  (6526 B), drain-dispose-corruption-check.ts (7355 B), it0-ceiling-check.sh
  (4036 B), it0-ceiling-line-budget-che"
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
md5 comparison run today: drain-scheduler.ts (6526 B), drain-dispose-corruption-check.ts (7355 B), it0-ceiling-check.sh (4036 B), it0-ceiling-line-budget-check.sh (6776 B), it0-dashboard-line-budget-check.sh (2095 B) and it0-gate-hash-check.sh (7603 B) are all IDENTICAL between the live experiments dir and archive/2026-10-28-retired-gate-scripts-orphan/, i.e. the retirement archive holds code that is still in production use (it0-dod-check.sh is invoked per CLAUDE.md:150).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793965687346` · ts `2026-11-06T11:48:07.346Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`drain-scheduler.main`、`drain-dispose-corruption-check.checkBodyIntegrity`、`it0-ceiling-check`
- 涉及文件：
- `archive/2026-10-28-retired-gate-scripts-orphan/plugin/gate-scripts/drain-scheduler.ts:85`
- `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts:85`
- `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts:67`
- `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh:1`
- kind：`duplication`
- verdict：`CONFIRMED — 6 byte-identical live↔'orphan' archive pairs`

## Requested action
delete the 6 archive copies (experiments/quay-perpetual-stream/scripts is authoritative); the 2 same-named files that genuinely diverged — it0-dod-check.sh and it0-dogfood-evidence-gate.sh — are correct frozen snapshots and must stay.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T11:48:07.346Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `archive-retired-gate-scripts-still-byte-identical-to-live`（routine `architecture-analysis`，runId `architecture-analysis-1793965687346`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `archive/2026-10-28-retired-gate-scripts-orphan/plugin/gate-scripts/drain-scheduler.ts`
- `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts`
- `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts`
- `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh`
- `tasks/gap-routine-architecture-analysis-archive-retired-gate-scripts-still-byte-identica.md`
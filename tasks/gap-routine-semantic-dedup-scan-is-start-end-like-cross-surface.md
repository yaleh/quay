---
id: gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface
title: "semantic-dedup-scan: Both predicates are character-for-character
  identical across the plugin/packages boundary (eventKind short-circuit plus
  timing-marker presence); observation.ts"
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
Both predicates are character-for-character identical across the plugin/packages boundary (eventKind short-circuit plus timing-marker presence); observation.ts declares itself an EXACT mirror of fast-mode-telemetry but no source-level test names isStartLike/isEndLike, so the declared mirror is unpinned and can drift silently.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791353789266` · ts `2026-10-07T06:16:29.266Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isStartLike`、`isEndLike`
- 涉及文件：
- `plugin/scripts/fast-mode-telemetry.ts:1370`
- `plugin/scripts/fast-mode-telemetry.ts:1375`
- `packages/quay/src/observation.ts:269`
- `packages/quay/src/observation.ts:275`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
move the pair into Core as the single definition and import it from the plugin, or add a source-parity assertion

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `is-start-end-like-cross-surface`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791353789266`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/fast-mode-telemetry.ts`
- `packages/quay/src/observation.ts`
- `tasks/gap-routine-semantic-dedup-scan-is-start-end-like-cross-surface.md`
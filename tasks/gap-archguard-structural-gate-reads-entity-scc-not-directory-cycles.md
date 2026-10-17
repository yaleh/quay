---
id: gap-archguard-structural-gate-reads-entity-scc-not-directory-cycles
title: archguard-runner 结构闸只读实体粒度 sccCount——目录级环存在时仍报 0（与 detect_cycles(package) 矛盾）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/archguard-runner.ts:143` 只读 `class/all-classes.json` 的 `metricVector.sccCount`——那是实体/类粒度 SCC。目录级环在分析产物的 TS module graph 里（MCP 面读 `.archguard/query/<scope>/arch.json` 的 `extensions.tsAnalysis.moduleGraph.cycles`），runner 完全不读。实测（ClaudeCodeUI chat scope a24387f8，HEAD 6952b3091）：`detect_cycles(outputScope=package)` 报 8 元目录环 `[audio, composer, export, hooks, tools, tools/ContentRenderers, transcript, utils]`，而同 scope 的实体粒度 `cycleCount` 全 0。本仓库 `arch-coverage-report.ts` 头注释自证 `plugin/scripts` 被建模为单包时 `detect_cycles` 在 3 个 SCC 的树上返回 `[]`。⇒ 当前「无环」闸在只有目录环的树上恒绿（false-clean）。

## Plan

1. 在 `readScopeSignal` 增加目录级环读数：从分析产物读 TS module graph 的 cycles（先核 `archguard analyze` CLI 把该产物写到哪；MCP 面已知在 `<workDir>/query/<scope>/arch.json` 的 `extensions.tsAnalysis.moduleGraph.cycles`）。
2. `HistoryRecord` 拆两个字段：`entitySccCount`（现有读数）与 `directoryCycleCount`（新读数），各自带 `evaluated: boolean` + `reason`。
3. TS scope 的闸改为目录级环（`directoryCycleCount > 0` ⇒ fail）；读不到 module graph 的 scope 记 `evaluated:false` + `reason`，不算「0 环」。
4. 负控制 fixture：构造只有目录环、实体 SCC 为 0 的树，断言 runner exit 1 且点名环成员。

## Acceptance Criteria

- [x] AC1（能取假·目录环）fixture 模块图有 1 个目录环、实体 SCC 为 0 ⇒ runner exit 1 且 stderr 点名该环成员；仍 exit 0 即假。
- [x] AC2（两粒度真分开）同一 fixture 的 metrics 记录 `entitySccCount=0` 且 `directoryCycleCount>=1`——两个不同值，证明不是同一数的两个名字。
- [x] AC3（负控制）无环 fixture ⇒ exit 0，记录 `directoryCycleCount=0, evaluated:true`。
- [x] AC4（未评估态）无 TS module graph 的 scope ⇒ 记录 `evaluated:false` + `reason`，不与「0 环」同值。

## Definition of Done

runner 对只有目录环的树 exit 1 并点名环成员；metrics 记录区分 `entitySccCount`/`directoryCycleCount` 且各有 evaluated 态；AC1–AC4 勾。

## Touches

- plugin/scripts/archguard-runner.ts（readScopeSignal + main 环判定 + HistoryRecord）
- plugin/test/archguard-structural-gate-fan-in.test.mjs（目录环 fixture 负控制）
- tasks/gap-archguard-structural-gate-reads-entity-scc-not-directory-cycles.md
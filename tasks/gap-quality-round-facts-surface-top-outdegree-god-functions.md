---
id: gap-quality-round-facts-surface-top-outdegree-god-functions
title: quality-round 事实只读环与覆盖率——把 topByOutDegree god-functions 与关系类型分布也读进
  quality-round（只读既有 archguard 产物，不 spawn）
status: todo
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

本会话的改进项里，两条直接来自 archguard_summary 的非环读数：topByOutDegree 的 god functions（run=39 / handleAllRoutes=35 / runResidentLoop=30，生了 worker-driver 拆分 finding）与 relationCountByType（inheritance=13 / call=2，暴露图的能力边界）。而 quality-gate-driver 的 arch-cycle-report（ARCH_CYCLE_ROUTINE_NAME）与 arch-coverage-report 目前只读目录环与覆盖率；architecture-analysis probe（done 接线）路由的是 cycle/god-package/duplication → milestone-candidate，不含 topByOutDegree 与关系类型分布。这两条读数跟环一样是 .archguard/query/ 的廉价只读产物，却没有任何 standing 事实把它们写进 quality-round。

## Plan

1. 读 quality-gate-driver.ts 的 arch-coverage-report（ARCH_COVERAGE_ROUTINE_NAME）与 readDirectoryCycleReading 的读产物方式。
2. 让该例程（或 arch-cycle 同批）额外读 .archguard/query/ 的 topByOutDegree 前 N 与 relationCountByType，写进 quality-round 的 fact.value。
3. 只读、零 spawn、零重分析（gap-fan-in-remove-archguard-gate 的教训：不把 27s/task 的 analyze 拉进每轮 tick）。

## Acceptance Criteria

- [ ] 一条新的 quality-round 记录里出现 topByOutDegree（前 N 实体名+出度）与 relationCountByType 读数，可从 .archguard/query/ 既有产物独立复现（贴出前 3 条位置证据）。
- [ ] 该例程仍为只读（无 archguard analyze spawn；用假 work-dir 负对照验证读不到时不冒充 0）。

## Definition of Done

- 两条 AC 全绿；例程改动经 scripts/test.sh 相关泳道通过，合并进 develop。

## Touches

- tasks/gap-quality-round-facts-surface-top-outdegree-god-functions.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/archguard-runner.ts
---
id: gap-arch-cycle-report-only-routine
title: 目录级环读数接周期 report-only 例程——让断环后的尺子有持续消费者（不上关键路径）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-archguard-structural-gate-reads-entity-scc-not-directory-cycles` 让 archguard-runner 能读目录级环了，但 runner 是 on-demand（`gap-fan-in-remove-archguard-gate` 从 fan-in 刻意移除：244 条 metrics 从未红、27s/task 零指引），`worker-driver.ts:364`/`worker-fan-in.ts:2719` 里全是注释、自 10-11 没跑过——新能力无消费者。按 `arch_coverage_report` 的声明式 report-only 例程模式（`loop.arch_coverage_report:` → `archCoverageRoutineFromConfig`），把目录级环读数接成周期例程：每 due 轮读一次环、append 一行到 `.quay/arch-cycle-history.jsonl`，只报不闸。

## Plan

1. 在 `plugin/scripts/quality-gate-driver.ts` 增 `loop.arch_cycle_report:` 声明式段（`enabled` 布尔必填 + `interval:<N>m`，缺省 360m、off-by-default）与 `archCycleRoutineFromConfig`（照 `archCoverageRoutineFromConfig` 模式：缺席 ⇒ 例程表不变；enabled:false ⇒ not-evaluated:disabled 零写入；写坏 ⇒ failed 零写入）。
2. 例程 run 体：读目录级环（复用 archguard-runner 已落地的 directoryCycleCount 读数，或直接读最近一次 analyze 的 `tsAnalysis.moduleGraph.cycles`），append 到 `.quay/arch-cycle-history.jsonl`。
3. report-only：环非空**不**使例程轮 failed（区别于闸）；读不到 moduleGraph ⇒ `evaluated:false` + reason（不与「0 环」同值，硬规则 3b）。
4. 新载体登记：`.gitignore` + `docs/carrier-registry.json`。

## Acceptance Criteria

- [ ] AC1（能取假·生产产出）声明后 post-landing 例程轮在 `.quay/arch-cycle-history.jsonl` 产生记录（真跑，非仅实现）；无新记录即假。（待外部）
- [ ] AC2（report-only）环非空时例程 state 仍 `verified`（不是 failed），且记录含环成员列表。
- [ ] AC3（未评估态）读不到 moduleGraph 时记 `evaluated:false` + reason，不与「0 环」同值。
- [ ] AC4（零覆盖影响）段缺席 ⇒ 例程表不变（builtin 四条仍「恰好四条」，同 archCoverageRoutineFromConfig 的既有测试）；enabled:false ⇒ not-evaluated:disabled 且零写入。

## Definition of Done

周期例程落地、report-only、环读数持续入载体；AC2–AC4 勾（AC1 待外部）。

## Touches

- plugin/scripts/quality-gate-driver.ts（arch_cycle_report 解析 + 例程装配）
- plugin/scripts/archguard-runner.ts（若需导出/复用 directoryCycleCount 读法）
- plugin/test/quality-gate-driver.test.mjs（例程装配测试：AC2/AC3/AC4）
- .gitignore（新载体声明）
- docs/carrier-registry.json（新载体登记）
- tasks/gap-arch-cycle-report-only-routine.md
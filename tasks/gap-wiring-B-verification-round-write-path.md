---
id: gap-wiring-B-verification-round-write-path
title: 接线任务 B（根因②）：verification-round 错写入方——两条任务改 full-suite-runner.ts 而真实写入走
  pre-verified-round-record.ts
status: ready
labels:
  - gap
  - mechanism
  - wiring
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-20 接线审计（8 NOT-WIRED 之一根因②）。Touches 与 A、C 零交集（manager 按交集算过）。

**根因**：`fan-in-execute.js:627` 真实写入 verification-round 走的是 `pre-verified-round-record.ts`，而这两条任务改的是 `full-suite-runner.ts`——那条路径在真实 fan-in 上根本不执行。

**两条未接线任务**：
- `gap-verification-round-observability-holes`：`lock_wait_ms` 与 `effective_parallelism` 在 **337 条真实记录中出现 0 次**。⚠️ 任务体 Evidence 自己写明「pre-verified-round-record.ts 是另一条写入路径…未改，留给后续任务统一」，**却仍以 AC 全勾翻了 done**——判据与落盘状态脱节（manager 特别指出，单独记）。
- `gap-verification-round-phases-overlap-merged`：落地后 **78/78 (100%)** overlap 轮 `lowconc_phase_ms` 仍为 0。

**⛔ Touches 边界**：`plugin/scripts/pre-verified-round-record.ts` + `plugin/scripts/full-suite-runner.ts` + `scripts/test.sh`。与 A、C 零交集。

## Plan

1. 核实真实写入路径（fan-in-execute.js:627 → pre-verified-round-record.ts）与两条任务改的 full-suite-runner.ts 的关系。
2. 把两条任务的字段（lock_wait_ms / effective_parallelism / lowconc_phase_ms）接入真实写入路径 pre-verified-round-record.ts。
3. 生产载体验证：落地后 verification-round.jsonl 中这些字段出现非退化真实值（N 只计落地后窗口）。
4. ⚠️ gap-verification-round-observability-holes 的「判据与落盘脱节」——复核其 done 是否应重开或补一条读生产载体的 AC。

## Acceptance Criteria

- [ ] AC1: lock_wait_ms / effective_parallelism / lowconc_phase_ms 接入真实写入路径（pre-verified-round-record.ts），不再只写在 full-suite-runner.ts 死路径。
- [ ] AC2: 生产载体验证——落地后 verification-round.jsonl 中这些字段有 ≥N 条非退化真实值（N 只计落地后窗口）。
- [ ] AC3: gap-verification-round-observability-holes 的「判据与落盘脱节」处置（重开或补读生产载体 AC）。
- [ ] AC4: 全量 suite 绿。

## Definition of Done

- [ ] 字段接入真实路径 + 生产载体验证 + observability-holes 脱节处置 + 全量 suite 绿。

## Touches

- plugin/scripts/pre-verified-round-record.ts（真实写入路径）
- plugin/scripts/full-suite-runner.ts（死路径处置）
- scripts/test.sh（若影响测试）
- tasks/gap-wiring-B-verification-round-write-path.md（自身）

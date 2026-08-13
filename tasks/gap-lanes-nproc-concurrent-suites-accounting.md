---
id: gap-lanes-nproc-concurrent-suites-accounting
title: lanes/nproc/并发套件数入账——2 槽锁后并发数是新变量，不记则跨轮不可比
status: todo
labels:
  - gap
  - mechanism
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**人指令（2026-08-13）「创建相关任务」；属【性能探索线】，不服务任何阶段 AC ⇒ 排在停全局轮关键路径之后**，
不得挤占 `gap-spec11-retest-2h-nondegradation` 及 AC42/43/45/46 相关任务。A0b⑤(a) 已执行：无重复。

**理由**：2 槽锁（gap-single-flight-lock-2-slot-concurrent-suites）之后，**并发套件数是新变量**——
不记则跨轮不可比：「这轮更慢」分不清是机器忙、活多了、还是并发数变了。

**现状缺口**：`verification-round.jsonl` 已记 `laneCount`，但**没记 `nproc`（机器核数）与并发套件数
（QUAY_MAX_CONCURRENT_SUITES 下实际同时在跑的套件数）**。跨宿主（16 核 vs 8 核）或并发模式切换
（1 套件 vs 2 套件）下，同一墙钟读数含义完全不同。

## Plan

1. 在 verification-round.jsonl 每轮记录：`nproc`（os.availableParallelism()，读宿主非字面量）、
   并发套件数（QUAY_MAX_CONCURRENT_SUITES + 实际同时在跑数）。
2. 与 task①（相边界差分记账）共用同一记账点，避免两处漂移。
3. 负控制：2 套件并发轮 + 1 套件轮各一轮，记录能区分并发数。

## Acceptance Criteria

- [ ] AC1 每轮记录 `nproc`（读宿主）+ 并发套件数（含实际同时在跑数）。
- [ ] AC2 1 套件轮 vs 2 套件轮的记录可区分（负控制，实跑各一轮）。
- [ ] AC3 跨宿主可比：`nproc` 变化时读数语义不歧义。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 字段落地 + 负控制两轮记录可区分。
- [ ] 与 task① 记账点共用，无两处漂移。

## Touches

- plugin/scripts/full-suite-runner.ts（记账点：nproc + 并发套件数）
- plugin/test/full-suite-runner.test.mjs（负控制用例）
- tasks/gap-lanes-nproc-concurrent-suites-accounting.md（自身）

## Evidence

（落地后回填）

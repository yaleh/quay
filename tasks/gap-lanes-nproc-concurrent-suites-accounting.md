---
id: gap-lanes-nproc-concurrent-suites-accounting
title: lanes/nproc/并发套件数入账——2 槽锁后并发数是新变量，不记则跨轮不可比
status: done
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

- [x] AC1 每轮记录 `nproc`（读宿主）+ 并发套件数（含实际同时在跑数）。
- [x] AC2 1 套件轮 vs 2 套件轮的记录可区分（负控制，实跑各一轮）。
- [x] AC3 跨宿主可比：`nproc` 变化时读数语义不歧义。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 字段落地 + 负控制两轮记录可区分。
- [x] 与 task① 记账点共用，无两处漂移。

## Touches

- plugin/scripts/full-suite-runner.ts（记账点：nproc + 并发套件数）
- plugin/test/full-suite-runner.test.mjs（负控制用例）
- tasks/gap-lanes-nproc-concurrent-suites-accounting.md（自身）

## Evidence

- **字段落地**：`verification-round.jsonl` 每轮记录新增三个并发变量字段（`plugin/scripts/full-suite-runner.ts`）：
  - `nproc` — 读宿主（`os.availableParallelism()`，同 defaultLaneCount 表达式；`RESOURCE_GATE_NPROC` 为确定性测试缝），非字面量（硬规则 4 推论二族）。
  - `concurrentSuiteSlots` — 配置槽位数（`QUAY_MAX_CONCURRENT_SUITES`，旋钮②，单一定义点）。
  - `concurrentSuitesRunning` — 实际同时在跑套件数 = 1（本轮自身槽位）+ 探测到的其他套件已占槽位数，封顶于槽位数（排队中的第三套件不算第三同时在跑）。
  - 探测实现：`countHeldSuiteLocks(root)` 用 `flock -n <file> true` 非阻塞探测 `<git-common-dir>/full-suite.lock.0/.1`（与 test.sh 的 `full_suite_lock` 同一路径解析：`FULL_SUITE_LOCK_FILE` 覆盖 → git-common-dir → `<root>/.git` 回退；父目录缺失视为空槽）。
- **与 task① 共用记账点**：字段写入 `appendVerificationRound`（每轮唯一的 suite-duration 记录），无第二处记账点，无两处漂移。
- **负控制（AC2）**：`plugin/test/full-suite-runner.test.mjs` 新增 3 用例——
  1. AC1 用例：空槽轮记录 `nproc=8`（RESOURCE_GATE_NPROC 缝）、`concurrentSuiteSlots=2`、`concurrentSuitesRunning=1`；
  2. AC2 用例：另一套件占 1 槽（flock holder 模拟）→ 记录 `concurrentSuitesRunning=2`，与空槽轮（=1）机械可区分；
  3. AC3 用例：两槽全占 → 封顶于 2，绝不报 3。
- **scoped 门**：`scripts/test.sh --for-task gap-lanes-nproc-concurrent-suites-accounting --allow-thin` 绿（全绿输出见 dispatch 报告）。
- **既有测试**：`plugin/test/full-suite-runner.test.mjs` 全量 132 用例绿（含新增 3 用例）。

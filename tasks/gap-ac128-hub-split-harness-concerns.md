---
id: gap-ac128-hub-split-harness-concerns
title: AC128 hub 单体按关切拆文件（红解析/并发-lanes/闸门-static/树态/状态写，爆炸半径收窄）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-suite-hub-file-responsibility-strip
---

**type:** execution

## Proposal

**来源**：manager 投「结晶」阶段 AC128（判据正本在 `orchestration/manager-phase-goal.md` AC128 段）。

**形态**：把 `test.sh` + `full-suite-runner.ts` 剩余 harness-critical 关切各拆聚焦文件（红解析 / 并发-lanes / 闸门-static / 树态 / 状态写）。

**为什么 inner 执行**：改两个 hub 单体（scripts/test.sh + full-suite-runner.ts）→ inner 域。

## Plan

1. 按关切拆五组聚焦文件：红解析（gateScanCause/isFailureLine/buildStaticCheckFailures）、并发-lanes（hostParallelism/concurrentSuiteSlots/spliceConcurrency）、闸门-static（resource_gate_check/run_static_checks）、树态（snapshotAssertionSurface/readTreeState/readVerifiedCommit）、状态写（writeStateGuarded/appendVerificationRound）。
2. ⛔ 新文件仍是 hub（harness-critical 须全量验证），拆分后 HUB_FILES 逐文件核。
3. 全量绿 + 分桶选择行为不变。

## Acceptance Criteria

- [ ] AC1（能取假，grep 函数名）：五组函数名原两单体命中 0、各自新文件命中（红/并发/闸门/树态/状态写各归其位）。
- [ ] AC2：全量绿 + 分桶选择不变。
- [ ] AC3：HUB_FILES 拆分后逐文件核，新 hub 文件触发全量（hub 规则保持）。

## Definition of Done

- [ ] 五关切拆分完成 + 函数名 grep 归位 + 全量绿 + hub 清单核；AC1-3 全勾；land 到 develop。

## Retires

net-add: 一次性重构成本非机制净增（与 AC112 计数基线显式记）。

## Touches

- scripts/test.sh
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/runner-red-parse.ts (new)（红解析，落点 inner 定）
- plugin/scripts/runner-concurrency.ts (new)（并发-lanes）
- plugin/scripts/runner-static-gate.ts (new)（闸门-static）
- plugin/scripts/runner-tree-state.ts (new)（树态）
- plugin/scripts/runner-state-write.ts (new)（状态写）
- plugin/scripts/suite-bucket-hub-list.ts（HUB_FILES 核）
- tasks/gap-ac128-hub-split-harness-concerns.md（自身）

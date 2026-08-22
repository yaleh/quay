---
id: gap-ac128-hub-split-harness-concerns
title: AC128 hub 单体按关切拆文件（红解析/并发-lanes/闸门-static/树态/状态写，爆炸半径收窄）
status: ready
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
- plugin/scripts/runner-red-parse.ts (new)
- plugin/scripts/runner-concurrency.ts (new)
- plugin/scripts/runner-static-gate.ts (new)
- plugin/scripts/runner-tree-state.ts (new)
- plugin/scripts/runner-state-write.ts (new)
- plugin/scripts/suite-bucket-hub-list.ts（HUB_FILES 核）
- plugin/scripts/select-static-checks-for-touches.ts（registry 正本 repoint 到 runner-static-gate.ts）
- plugin/scripts/checker-mutation-check.sh（run_static_checks 从 runner-static-gate.ts 解析，run_doc_checks 仍从 test.sh）
- plugin/scripts/rhythm-consumer-check.ts（strict surface + 判据3 --no-block 读 runner-static-gate.ts）
- plugin/scripts/red-on-omission-audit.ts（接入判据改查 suite static-gate 两面）
- plugin/scripts/capability-catalog.sh（新文件注册 5×5 表）
- plugin/scripts/axis-generator.ts（run_static_checks 抽取源 repoint to runner-static-gate.ts——漏迁移消费者，硬规则 5b）
- plugin/scripts/precommit-guard.ts（staticObjectPatterns 聚合 @static-object：test.sh + runner-static-gate.ts——漏迁移消费者，硬规则 5b）
- plugin/scripts/judgment-consumer-check.ts（judgment-consumer-check 判据 registry 的 obligation 台账 verify 从 scripts/test.sh 迁到 runner-static-gate.ts——漏迁移消费者，硬规则 5b）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照再生成）
- plugin/test/checker-mutation-check.test.mjs（fixture 迁移到 runner-static-gate.ts）
- plugin/test/dispatch-worktree-setup.test.mjs（wiring 断言迁移）
- plugin/test/red-on-omission-audit.test.mjs（wiring 断言回指 run_doc_checks/test.sh）
- plugin/test/resource-gate.test.mjs（gate 调用断言迁移到 runner-static-gate.ts）
- plugin/test/rhythm-consumer-check.test.mjs（--no-block 抽取源迁移）
- plugin/test/scoped-static-checks.test.mjs（registry 正本/夹具迁移）
- plugin/test/select-static-checks-for-touches.test.mjs（TEST_SH/夹具迁移）
- plugin/test/suite-speed-nested-skip.test.mjs（run_static_checks 断言迁移）
- plugin/test/axis-generator.test.mjs（枚举源迁移——漏迁移消费者，硬规则 5b）
- plugin/test/fan-in-ff-executor-check.test.mjs（resolveDeltaCodeSurface 面随 staticObjectPatterns 修复——漏迁移消费者）
- plugin/test/fan-in-execute-paths.test.mjs（symlinkRuntimeTrees fixture 补 runner-static-gate.ts——漏迁移消费者）
- tasks/gap-ac128-hub-split-harness-concerns.md（自身）

---
id: gap-ac125-suite-bucket-no-miss-negative-control
title: AC125 漏测负控制（3 次真实跨层回归回放 3/3 仍选中会红的测试——唯一的"没漏"判据）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac120-suite-bucket-attribution-mechanism
  - gap-ac122-suite-bucket-hub-list-full-suite
  - gap-ac123-suite-bucket-cross-bucket-both-sides
---

**type:** execution

## Proposal

**来源**：`orchestration/manager-phase-goal.md` 当前阶段 AC125（⛔ 唯一证明「没漏」的判据——其余五条都在证明「能省」）。

**判据（能取假）**：取本仓历史上**至少 3 次真实的跨层回归**（一个桶的源码改动打红了另一个桶的测试；从 `verification-round.jsonl` 红轮 + 对应提交回溯），回放分桶规则，**必须 3/3 仍然选中那个会红的测试**。

**⊢ 为什么必须有这条**：AC120-124 都在证明「能省」，只有这条在证明「没漏」。⛔ 缺这条则本阶段的达成等于一个恒绿判据。

**为什么 inner 执行**：回溯历史红轮 + 回放分桶规则 → inner 域。

## Plan

1. 从 `verification-round.jsonl` 红轮 + 对应提交回溯至少 3 次真实跨层回归（一桶源码改动打红另一桶测试）。
2. 对每次回归回放分桶规则，确认那个会红的测试仍在选中集。
3. 记录 3/3 回放结果，可复核。
4. fan-in land。

## 执行证据（inner 2026-08-21）

**判定：3/3 回放仍选中会红的测试 —— 分桶规则没有漏测。**

回溯方法：从 `.quay/verification-round.jsonl` 取 `state=red & reason=failed` 红轮，用 `git show` 回溯对应提交（红轮自身 commit 常为任务文件翻转，故再向上一源码提交回溯因果源码），用 AC120 `suite-bucket-attribution.ts` 对红测文件做桶归属，用 AC122 `suite-bucket-hub-list.ts` 对变更文件做枢纽判定，回放「枢纽→全量；否则触发桶与测试桶集合求交」的选择规则。

### 回归 1（R-105，M 源码 → P 测试，跨桶靠静态引用闭包 AC120）
- 红轮：round 105，commit `a505e7b0a38ba74c6bee9a96bf444cb5f9c370a7`（2026-08-13T02:16:56Z），state=red/reason=failed。
- 因果源码：`8781f798b6c1648107ca1b766b73cf6fc18f76cc`「precommit-guard 接进 quay-init --loop 铺设集」，改 `plugin/scripts/quay-init.sh`（M 桶）。回归由后续修复 `06c251bf`「precommit-guard 回归修正」反证。
- 红测：`packages/quay/test/install-config-driven-e2e-runtime.test.mjs`（P 目录，AC120 归属 `P+M`）。
- 回放：hub 判定 `bucket`（quay-init.sh 非枢纽）；触发桶 {M}；红测 {P+M} ∋ M ⇒ **选中**。

### 回归 2（R-19，M 源码 → 调 test.sh 当壳的测试，AC121 重归属）
- 红轮：round 19，commit `00f45fc639a246560bcd8047f08a19b8384d14bf`（2026-08-12T10:39:12Z）。
- 因果源码：`37c068ae76ebd74b714b538e15fb91d3bf32e4e2`「gap-ac39-accounting-emit-layer — layer→mechanisms 映射表」，改 `plugin/scripts/accounting-emit-layer-map.ts`（M 桶）。
- 红测：`plugin/test/ac36-sortkey-criterion-check.test.mjs`（AC120 归属 `S+M`；AC121 重归属判 `M` —— 正是 phase-goal AC121「只把 test.sh 当壳却测 M 机件」的漏测风险样本）。
- 回放：hub 判定 `bucket`；触发桶 {M}；红测 {S+M} ∋ M ⇒ **选中**。

### 回归 3（R-8，枢纽源码 → P 测试，靠 AC122 枢纽退回全量）
- 红轮：round 8，commit `b59ffaf06880fc026feada9b279dcc38da667a1c`（2026-08-12T06:55:36Z）。
- 因果源码：同 commit「cancel CPUQuota」，改 `plugin/scripts/full-suite-runner.ts`（AC122 枢纽清单成员）+ `plugin/scripts/resource-gate.sh`（M）。
- 红测：`packages/quay/test/delivery-standalone-smoke-gate.test.mjs`（P 目录，AC120 归属 `P`）。
- 回放：hub 判定 `full`（full-suite-runner.ts 命中枢纽清单）⇒ 无条件全量 ⇒ **选中**。

**结论：3/3 回放仍选中会红的测试；0 miss。** 三种防漏机制各自被一个真实回归覆盖：AC120 静态引用闭包（回归 1）、AC121 重归属（回归 2）、AC122 枢纽退回全量（回归 3）。

## Acceptance Criteria

- [x] AC1: 回溯 ≥3 次真实跨层回归（verification-round.jsonl 红轮 + 对应提交）。
- [x] AC2: 分桶规则回放，3/3 仍然选中那个会红的测试。

## Definition of Done

- [x] ≥3 次真实跨层回归回放 3/3 仍选中会红测试；land 到 develop；AC1-2 全勾。

## Touches

- tasks/gap-ac125-suite-bucket-no-miss-negative-control.md（自身）

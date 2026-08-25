---
id: gap-ac153-core-invariant-single-impl-not-evaluated-vocab
title: AC153 核心不变式单一实现 + DriverResult 词表强制含 not-evaluated
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worker-driver-no-record-on-abnormal-death
  - gap-ac141-execution-face-inner-manual-retirement
  - gap-direct-to-develop-check-reflog-to-revlist
  - gap-git-history-branch-summary-wrong-numbers
  - gap-launch-script-worker-cap-broken
---

**type:** execution

## Proposal

**来源**：manager 2026-08-23 架构裁定（判据正本 `orchestration/manager-phase-goal.md` `### AC153`，⛔ 不在此复制；设计正本 `orchestration/SPEC-unified-driver-architecture-2026-08-23.md` §2.1「共同不变式」）。

**缺口（实测）**：「⛔ 不信执行者自述，用独立于执行者的量复核」这条核心不变式**被独立实现两遍**：
```
promotion AC133   「fix worker 退出后重跑同一个闸验证 ⛔ 不信 worker 自述」
worker             computeLandingState（⛔ 2026-08-23 11:37 之前 exitCode===0 ⇒ completed，是坏的）
```
⇒ 抽 kernel 的第一理由不是省代码，是让这条不变式**只有一份、且结构上不可能被某个 kind 悄悄漏掉**。

**⊢ 排期注记**：本任务属下一阶段（架构地基），⛔ 现在只立案不派发——`depends_on` 即 SPEC §0 的排期锁（AC142 系列收口），不是输出依赖。manager 建议 AC152+AC153 先做。⛔ AC151/AC152/AC153 三者都动 kernel/filter 同一片区域，**不并发**，按 AC152→AC153→AC151 单条推进。

## Plan

1. `DriverResult<T>` 词表单一实现：`verified | not-evaluated | failed`，`not-evaluated` 与 `verified` 不同形。
2. 「不信执行者自述」不变式收敛为一份，promotion（AC133 verify）与 worker（computeLandingState）都消费它。

## Acceptance Criteria

判据正本在 `orchestration/manager-phase-goal.md` `### AC153`（⛔ 取假形态不在此复制）。

- [x] AC1：核心不变式只存在一份，两 kind 共用；任一 kind 能在未经独立判据证实时产出 `verified` ⇒ 假。
- [x] AC2：`DriverResult` 词表强制含 `not-evaluated`；「读不到输入」被表达成非 `not-evaluated` 的值 ⇒ 假；取假见正本 AC153。

## Definition of Done

- [x] 核心不变式单一实现 + DriverResult 词表含 not-evaluated 落地；AC1-2 全勾；land 到 develop。

## Retires

- 无（promotion AC133 verify 与 worker computeLandingState 收敛到单一实现）

## Touches

- plugin/scripts/driver-result.ts（新：DriverResult<T> 词表 + 独立复核不变式单一实现）
- plugin/scripts/worker-driver.ts（computeLandingState 收敛到单一不变式）
- plugin/scripts/promotion-driver.ts（AC133 verify 收敛到单一不变式）
- plugin/test/driver-result.test.mjs（新 test）
- plugin/test/worker-driver.test.mjs（test）
- plugin/test/promotion-driver.test.mjs（test）
- plugin/scripts/capability-catalog.sh（新脚本 driver-result.ts 六表注册）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY scripts 计数 bump）
- tasks/gap-ac153-core-invariant-single-impl-not-evaluated-vocab.md（自身）

---
id: gap-worker-driver-retry-cap-not-wired
title: worker-driver 重试上限从未接线——promotion 有 retryExhausted、worker 空集 ⇒ 反复 exited-not-landed 无止损（性价比最高止血）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`driver-filters.ts:9` 明写「retryCapNotExhausted promotion 有 worker 无」；`:36-37` 注释「worker 无重试上限 ⇒ 空集」。`promotion-driver.ts:811` 已传 `retryExhausted: retryState.needsHuman`，而 worker-driver 从未接线（`retryExhausted` 恒空集）。⇒ worker 派发的任务可**无限次** exited-not-landed / defer 重派，无任何止损。实证 2026-08-25：`gap-suite-split-long-multi-test-files` 因 referenced-not-landed flaky 红，attempt 2-6 全同形卡在同一红、累计 501 分钟、7 次未落地——**「可绕过」（重跑即过）被「无重试上限」放大成「绕不完」**。接线不依赖搞清底层根因，立即止血。

## Plan

worker-driver 接 `retryCapNotExhausted` 谓词：worker 侧维护 retry 计数（同 promotion 的 retryState 形态），达到上限的任务标 needs-human（或记「retry-cap-exhausted」），不再无限重派。复用 `driver-filters.ts` 已有的谓词（`retryCapNotExhausted`），worker 只需补 `retryExhausted` 集合的填充（从 worker-outcome.jsonl 的 exited-not-landed/defer 计数派生）。

## Acceptance Criteria

- [ ] AC1（能取假，worker 有上限）：worker-driver 的 `retryExhausted` 集合非空派生（从 exited-not-landed 计数），达到上限任务不再重派（标 needs-human 或记 retry-cap-exhausted）；（⛔ 仍空集无限重派 ⇒ 假）。
- [ ] AC2（能取假，负控制）：造一个反复 exited-not-landed 的任务，改造后它在 N 次后停（不再无限重派）；（⛔ 仍无限 ⇒ 假）。
- [ ] AC3（能取假，promotion 不回归）：promotion-driver 的 retryExhausted 逻辑不回归（已有测试绿）；（⛔ 回归 ⇒ 假）。

## Definition of Done

worker-driver 接 retryCapNotExhausted；AC1/AC2/AC3 全勾；split-long 场景回放不再无限重派。

## Touches

- plugin/scripts/worker-driver.ts（retryExhausted 集合填充 + retryCapNotExhausted 谓词接线）
- plugin/scripts/driver-filters.ts（如需）
- plugin/test/worker-driver.test.mjs（retry cap 测试 + 负控制）
- tasks/gap-worker-driver-retry-cap-not-wired.md（自身）

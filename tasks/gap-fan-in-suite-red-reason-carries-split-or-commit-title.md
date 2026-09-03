---
id: gap-fan-in-suite-red-reason-carries-split-or-commit-title
title: fan-in suite red 的 reason 被设成「split-or-commit」标题而非真实失败摘要（归因错位）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  depends_on:
    - gap-retire-session-liveness
  schema: execution
---
## Proposal

fan-in suite red 时，`worker-outcome.jsonl` 的 `mechanical_fan_in.reason` / `verdict.summary` 被设成 `== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) ==` 这个**标题字符串**，而不是真实的失败摘要（session-liveness 的具体 AssertionError）。实测：mechanical-fan-in / test-file-snapshot / help-contract / scoped-gate-m120 等任务的 fan-in suite red，`reason` 全是这个「split-or-commit」标题，而 suite log 尾部真实失败是 `session-liveness-scd-busy` 等 flaky——归因错位。

**根因方向**：worker-driver 的 suite red 摘要提取（`extractFailureSummary` / `extractFirstFailureLine`，worker-driver.ts:2781 一带）从 suite log 里取了错误的行——把「split-or-commit whole-store check」这个检查器的**标题行**当成了失败摘要，而不是取 `# fail N` 对应的真实测试失败行（`__PERFILE__ ... passed=false` / `AssertionError`）。

**影响**：监控/归因困难——看到 reason 是「split-or-commit」，误判成 split-or-commit 检查失败，而实际是 session-liveness flaky 或别的失败。`plugin/test/worker-driver-fan-in.test.mjs` 的 AC1「suite red reason carries the real assertion text」**已经失败**（在抓这个缺陷），说明它被测试盯着但未修。

**与 m120 bug 同族**：`gap-scoped-gate-m120-negative-control-false-positive` 是「`isFailureSignalLine` 把负控制 stderr（`Could not resolve`）当失败信号」，本条是「`extractFailureSummary` 把 suite log 的标题行当失败摘要」——同一文件、同一套「失败信号/摘要提取」逻辑的两个独立缺陷，须并列修（修一个会撞另一个的测试）。

## Plan

1. 定位 `extractFailureSummary`/`extractFirstFailureLine` 为什么取到「split-or-commit whole-store check」标题行（grep suite log 里该标题行的位置 + 提取逻辑的行匹配顺序）。
2. 修：摘要提取改为取「真实失败行」（`__PERFILE__ ... passed=false` 或 `AssertionError` 行），不再是 suite log 里第一个「== ... ==」标题。
3. 回归：`worker-driver-fan-in.test.mjs` AC1 通过；一条真实 fan-in suite red 的 reason 含真实断言文本。

## Acceptance Criteria

- [x] AC1（能取假）：grep 一条真实 fan-in suite red 的 `worker-outcome` 记录，`mechanical_fan_in.reason` 含真实失败摘要（session-liveness / AssertionError 原文），不再是 `== split-or-commit ... ==` 标题。
- [x] AC2（既有测试转绿）：`plugin/test/worker-driver-fan-in.test.mjs` 的 AC1「suite red reason carries the real assertion text」通过。
- [x] AC3（负控制）：一个真 split-or-commit 检查失败的样本，reason 仍携带 split-or-commit 的真实失败（不因改提取逻辑而丢真失败）。
- [ ] AC4（既有不回归）：全量 suite 绿。（待外部）

## Definition of Done

fan-in suite red 的 `reason`/`summary` 携带真实失败摘要（真实失败测试的 AssertionError 原文），不再把 suite log 里的标题行当摘要；`worker-driver-fan-in.test.mjs` AC1 转绿；监控归因不再被「split-or-commit」标题误导。

## Touches

- plugin/scripts/worker-driver.ts（extractFailureSummary / extractFirstFailureLine 及其调用点）
- plugin/test/worker-driver-fan-in.test.mjs（reason 携带真实断言 + 负控制）
- tasks/gap-fan-in-suite-red-reason-carries-split-or-commit-title.md（自身）

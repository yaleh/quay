---
id: gap-scoped-gate-lpt-order
title: scoped-gate（--for-task）路径复用 suite-lpt-order + suite-lpt-runner.mjs（LPT +
  run({files}) 保序）
status: superseded
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  superseded_reason: 撤回（人 2026-09-01 经 peer 转述「不作通用优化」）——实测：scoped 并发 = default_test_concurrency = 16（nproc 宿主派生），scoped 集抽样 19/20 任务 ≤16 文件 ⇒ 全文件同时起跑、墙钟 = 集里最长文件、无长尾可消 ⇒ LPT 对 scoped 是空操作（node --test 多文件并发 + 字母序重排也不影响，反正全并发）。scoped 118s 均值的真实主导是「集里最长文件」，真正速度杠杆是拆长文件（gap-suite-split-long-multi-test-files 已在做）。唯一条件化规则（集 >16 文件时才用 run({files}) 保序）暂不立案。
---
**type:** execution

## Proposal

scoped-gate（`--for-task`，均值 118.5s、177 次/周=5.83h）有并发（`default_test_concurrency`）但不取 full-suite 锁；**未应用 LPT / `run({files})`**——裸 `node --test ${files}`，selector 输出顺序被 CLI 字母序重排（`gap-m-bucket` 同一教训：最长文件晚启动长尾）。复用 `suite-lpt-order.ts` + `suite-lpt-runner.mjs`（LPT + `run({files})` 保序），与 full-suite 主路径同构，消除 scoped 路径的长尾。

## Plan

1. scoped-gate 派发改为 LPT 排序（复用 `suite-lpt-order.ts` 读 verification-round 历史）。
2. 用 `suite-lpt-runner.mjs run({files})` 保序执行（替代裸 `node --test ${files}` 的字母序重排）。
3. 验证：scoped 路径最长文件启动 offset 回 0 附近；pass/fail-neutral。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：scoped-gate 路径经 `suite-lpt-runner.mjs run({files})` 保序（grep 无裸 `node --test ${files}` 字母序派发；见 LPT + run({files})）；（⛔ 仍裸 node --test ⇒ 假）。
- [ ] AC2（能取假，生产载体，硬规则 4 推论三）：落地后 scoped 轮最长文件启动 offset 回 0 附近（N 只计落地后）；（⛔ 用落地前轮冒充 ⇒ 假）。
- [ ] AC3（能取假，无回归）：同文件集同断言 pass/fail 结果一致（只改调度表达，不改测试集/断言）。

## Definition of Done

scoped-gate 路径 LPT + run({files}) 保序；AC1-3 勾；scoped 长文件 offset 回 0 实测。

## Touches

- scripts/test.sh（scoped-gate --for-task 派发路径——LPT + run({files})）
- tasks/gap-scoped-gate-lpt-order.md（自身）

## Needs-Human

**执行 2026-09-01T04:40:29.926Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）

---
id: gap-full-suite-runner-crash-test-rmSync-enotempty-flaky
title: full-suite-runner.test.mjs:4889 AC6 crash 测试 teardown rmSync 撞 ENOTEMPTY flaky——随机挡任意 fan-in
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`plugin/test/full-suite-runner.test.mjs:4889` AC6「runner dies from uncaughtException writes state=red」的 teardown `rmSync` 撞 `ENOTEMPTY`（crashed runner 的孤儿 lane 子进程残留，同 TaskStop-orphans 类）。随机挡任意任务 fan-in（实证 gap-suite-lpt 3 次 fan-in 2 次 suite red 均此条）。@test-group lowconc，非任何任务 Touches。flaky 前科见 :4892 注释。

## Plan

teardown 等 crashed runner 子进程退出（或 rmSync 重试/延迟重试），消除 ENOTEMPTY 竞态。

## Acceptance Criteria

- [ ] AC1（能取假）：teardown 不再撞 ENOTEMPTY（等子进程退出或 rmSync 重试）；（⛔ 仍 ENOTEMPTY ⇒ 假）。
- [ ] AC2（能取假，负载）：16-lane 满负载下 AC6 crash 测试多次无 ENOTEMPTY flaky。

## Definition of Done

teardown 竞态消除；AC1-AC2 全勾；全量 suite 绿；fan-in 不再被此 flaky 随机挡。

## Touches

- plugin/test/full-suite-runner.test.mjs（teardown 等子进程退出 / rmSync 重试）
- tasks/gap-full-suite-runner-crash-test-rmSync-enotempty-flaky.md（自身）

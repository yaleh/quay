---
id: gap-monitor-mount-check-ac5-timing-flaky
title: "monitor-mount-check.test.mjs AC5 时序 flaky——~5s 等 fake monitor pid 落盘，8 路并发下稳定超时（阻塞 lane-formula + observability-holes）"
status: todo
labels:
  - gap
  - test-flaky
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`plugin/test/monitor-mount-check.test.mjs` AC5（:252）等 fake monitor 的 pid 文件落盘 ~5s，在 8 路并发 + 重载下【稳定】超时（`AssertionError: orphaned fake monitor pid must be readable`）。**非间歇**——lane-formula 重 fan-in 两轮都撞（11:47 首红 + 12:04 重试仍红同因），说明是并发下的确定性时序缺陷，不是随机 flake。

这阻塞了 lane-formula（gap-lane-formula-ignores-phase-overlap-concurrency，它只碰 scripts/test.sh + full-suite-runner.ts，不碰 monitor-mount-check）以及其后的 observability-holes（也碰 full-suite-runner.ts）——suite-fix 正确判 reason=other-task（inScope=[] 零修复零 relaunch），但 out-of-scope 的 flaky 挡在真实任务前面。

## Acceptance Criteria

- [ ] AC1: monitor-mount-check AC5 改为更鲁棒的等待——轮询 pid 文件（带超时上限 + 重试）而非固定 ~5s sleep 后断言，8 路并发下稳定过。
- [ ] AC2: 负控制落在生产载体——8 路并发重载下 AC5 稳定过（多次全量 suite 不红），非单次侥幸。
- [ ] AC3: scoped 绿 + monitor-mount-check 相关测试不红。

## Definition of Done

- [ ] 8 路并发下 monitor-mount-check AC5 稳定过（真实输出，多轮复现不红），scoped 绿。

## Touches

- tasks/gap-monitor-mount-check-ac5-timing-flaky.md（自身）
- plugin/test/monitor-mount-check.test.mjs（AC5 鲁棒等待：轮询 pid + 超时上限）

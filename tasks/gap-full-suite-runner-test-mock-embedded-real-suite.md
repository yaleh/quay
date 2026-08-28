---
id: gap-full-suite-runner-test-mock-embedded-real-suite
title: mock full-suite-runner.test.mjs 内嵌真实 suite——579s → <120s（吞吐优化，非关键路径，首绿后落地）
status: ready
labels:
  - gap
  - throughput
parent: null
children: []
extra:
  schema: execution
  defer: post-mechanical-first-green
---
**type:** execution

## Proposal

全量 suite 地板 = `full-suite-runner.test.mjs` 的 `__CEILING__ duration_ms=578890`（~9.7min）——它通过 runner（`full-suite-runner.ts`）spawn 一个**真实全量 512-file suite** 来跑 e2e AC（waitExit、锁处理、phase 解析等），单文件地板不可并行化 ⇒ 每次全量 suite `main_phase` 被顶到 ~580s，+~4.5min/次（封顶者/该拆 已点名）。测试文件 166 测试/5172 行，且**已有 fake test.sh 缝**（`:206-214` `fakeTestShRecordingArgs`，记录 args + 打 green TAP）。

**⛔ 非关键路径**：无 `delivery-critical`，`extra.defer` 标「关键路径首绿后落地」，不与 force-color/watchdog/token-gate 争派发。

## Plan

1. 扩展/复用既有 fake-suite 缝（`fakeTestShRecordingArgs`），让昂贵 e2e AC 用「最小 fake suite」（几个真实可跑的假测试文件，秒级）替代真实 512-file suite。
2. ⛔ 不动 `plugin/scripts/full-suite-runner.ts`（产品路径零改动，只改测试侧）。
3. 保留必须真跑的 AC：真 spawn 子进程的（waitExit load-race、`QUAY_TEST_CRASH_AFTER_RUNNING`、`process.exit(0)` 等）原样保留——它们本身快。

## Acceptance Criteria

- [ ] AC1（能取假，时长降 + 真 spawn）：`full-suite-runner.test.mjs` 整体时长 <120s（当前 579s），且 runner 仍真实 spawn 并执行（假）suite（⛔ 测试不再走 runner 进程 ⇒ 假）。
- [ ] AC2（能取假，真实路径 + 负控制）：fake suite 输出是 runner 真实执行产生的（`__GROUP__`/`__OVERHEAD__`/`__CEILING__` 标记真实生成），一个故意失败的假文件仍产出 RED round / red verification-round 记录（⛔ 预烘 fixture 跳过 runner ⇒ 假，硬规则 4 推论三）。
- [ ] AC3（不误伤）：真 spawn 类测试仍跑真子进程且通过；产品 runner 不变（真实 suite 在 prod 仍正常）。
- [ ] AC4（衡量）：改后重跑全量 suite，`main_phase` 从 ~580s 降到下一地板（quay-init-loop ~317s 或更低），记录 before/after 读数。

## Definition of Done

fake suite 替代内嵌真实 512-file suite；AC1-AC4 全勾；`main_phase` 地板从 580s 降；产品 runner 零改动。

## Touches

- plugin/test/full-suite-runner.test.mjs（扩展 fakeTestShRecordingArgs 缝，昂贵 e2e AC 用最小 fake suite）
- plugin/test/fixtures/fake-suite/（假 suite fixture 文件，或复用现有 fake test.sh 机制）
- tasks/gap-full-suite-runner-test-mock-embedded-real-suite.md（自身）

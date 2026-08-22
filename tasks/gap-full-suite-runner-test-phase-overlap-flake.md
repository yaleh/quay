---
id: gap-full-suite-runner-test-phase-overlap-flake
title: full-suite-runner.test.mjs AC2 PHASE_OVERLAP 墙钟断言未标 @load-sensitive（16 并发确定性 flake，阻塞 fan-in）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：inner 上报（hub-strip fan-in 卡在 relaunch 循环的根因）。

**证据（能取假）**：`plugin/test/full-suite-runner.test.mjs` AC2 PHASE_OVERLAP 断言「phases wall sum ≈ durationMs」（:659，sum=189 vs durationMs=3754，差 3565ms > 3000ms 容差）——**含 wall-clock timing 断言却未标 @load-sensitive**（文件头 `// @test-group governance`，无 @load-sensitive），16 并发下确定性 flake（.prev 前一轮同样 passed=false）。fan-in 判 other-task defer 后 relaunch，但该测试确定性 ⇒ 可能无限 relaunch（hub-strip 已第 2 次 relaunch）。

**为什么 inner 执行**：改测试标注/断言 → inner 域。

## Plan

1. 先隔离重跑证明并发造成（C15：收编 serial 须先隔离重跑贴证据）。
2. 修二选一：(a) 标 `@load-sensitive wall-clock` 路由 serial（若墙钟断言保留）；或 (b) 把断言改确定性（不依赖墙钟 wall sum ≈ durationMs 的 3000ms 容差）。
3. 负控制：16 并发下重跑该测试不再 flake。

## Acceptance Criteria

- [x] AC1：PHASE_OVERLAP 墙钟断言不再在 16 并发下确定性 flake（隔离重跑证据 + 标注或断言确定性）。
- [x] AC2：hub-strip fan-in 不再因此测试无限 relaunch。

## Definition of Done

- [x] 测试 flake 修复（@load-sensitive 或断言确定性）+ 并发重跑绿；AC1-2 全勾；land 到 develop。

## Touches

- plugin/test/full-suite-runner.test.mjs
- tasks/gap-full-suite-runner-test-phase-overlap-flake.md（自身）

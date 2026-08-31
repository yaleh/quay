---
id: gap-splice-unit-direct-test
title: splice 测试改直测 spliceConcurrency 纯函数——4 个 e2e 各 spawn 一次全量 runner 换 import 直测（Tier 1）
status: ready
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

4 个 splice 测试（`full-suite-runner.test.mjs` :2089,:2119,:2418,:2561）各 spawn 一次全量 runner 只读拼接的 `--test-concurrency`，是重复的全量 spawn 开销。`spliceConcurrency` 已从 `plugin/scripts/runner-concurrency.ts` 导出但测试未 import。改 import 直测纯函数 + 留 1 个集成 keeper 保 wiring（runner 真把 N 拼进 spawn 命令）。

## Plan

1. splice 逻辑改纯函数单测（import `spliceConcurrency`），4 个 e2e 收敛为 1 个集成 keeper。
2. ⛔ 不删测试换时间（AC 逐条保留，纯函数单测覆盖原 e2e 的每条断言）。

## Acceptance Criteria

- [ ] AC1（能取假）：splice 逻辑由 `spliceConcurrency` 纯函数单测覆盖（4 个 e2e 的断言 → 纯函数单测）；（⛔ 纯函数未测 ⇒ 假）。
- [ ] AC2（能取假，wiring）：至少 1 个 e2e 保「runner 真把 N 拼进 spawn 命令」；（⛔ 无 e2e wiring 保 ⇒ 假）。

## Definition of Done

splice 直测落地；AC1-AC2 全勾；scoped 全绿；墙钟下降（贴前后读数）。

## Touches

- plugin/test/full-suite-runner.test.mjs（splice 测试收敛 + import）
- plugin/scripts/runner-concurrency.ts（spliceConcurrency 导出/import 面，若需）
- tasks/gap-splice-unit-direct-test.md（自身）

---
id: gap-suite-split-long-multi-test-files
title: 拆分含多个独立 test() 的长耗时文件——压缩 LPT 队列头（不限 bucket，makespan 下限）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**① 不限 bucket（manager 核实 round #563）**：LPT 重排 + 文件级并发是同一套机制（`suite-lpt-runner.mjs`），跑哪个 bucket 都有「队首长文件 + 闲置容量」。round #563（`buckets=P`，140 文件）perFile 前 21 个 vs 真正最长 21 个几乎逐一对应；负载曲线前 3 段均值 7.92、峰值 34.03、**比值 0.233（不到峰值 1/4）**，比 #560（M）的 0.55 更低（本次 sampler 采样跨度 250s 对齐真实耗时 255s，无孤儿污染，数据干净）。长 + 子进程重是这些文件占据 LPT 队首的根源。

**② 两种难度不同的文件（AC1 须分两类，不能一条结论覆盖）**：
- **node:test 多用例结构，可直接按 test() 边界拆**：`driver.test.mjs`（466 行 23 test 3 子进程）、`lifecycle.test.mjs`（905 行 55 test 4 子进程）、`ts-typecheck-gate.test.mjs`（110 行 5 test 2 子进程）✅。
- **无 test()/describe() 结构（手搓 assert()+failures 计数器）**：`cli.test.mjs`（2096 行 0 test()）、`mcp-server.test.mjs`（1736 行 0 test()）——不能按 test() 边界拆，需先把手搓断言重构成 node:test 用例，是更大一块活。⛔ 不纳入本任务 AC2/AC3 的一次性拆分，可选后续单独立案。

**③ round #563 候选清单（perFile 数据，供 Plan 取用）**：quay-init-loop-runtime 193.9s、quay-init-loop-vendor 170.1s（M/P 双 bucket 两轮证据）、install-config-driven-e2e-runtime 154.7s、install-config-driven-e2e-upgrade 152.3s、install-config-driven-e2e 139.7s、lifecycle 88.4s、acceptance 82.7s、cli 82.0s（②需先重构）、npm-pack-e2e 79.5s、driver 78.2s、integration-batch-merge 75.7s、ts-typecheck-gate 64.5s、serve-nav-inconsistent-routes 57.0s、delivery-standalone-smoke-gate 55.2s、codex-stage1-adapter 50.8s、mcp-server 46.2s（②需先重构）、sea-artifact-consumer-e2e 44.0s、session-liveness-restart 41.3s、serve-ac95-views 33.7s、init 31.6s、serve 27.8s。

## Plan

抽查 LPT 队首长文件确认可拆（②分两类：node:test 多用例直接判可拆/不可拆；无 test()/describe() 的标「需先重构」不纳入本次）；可拆的拆成多文件 + suite 仍绿 + makespan 改善。

## Acceptance Criteria

- [ ] AC1（能取假，独立性抽查分两类）：抽查 LPT 队首长文件，node:test 多用例判可拆/不可拆；无 test()/describe() 的（cli/mcp-server）标「需先重构、不纳入本次 AC2/AC3」；（⛔ 未抽查或笼统一条结论覆盖两类 ⇒ 假）。
- [ ] AC2（能取假，拆分不破坏）：可拆长文件拆成多个文件，suite 仍绿（行为不变）；（⛔ 拆分后 suite 红 ⇒ 假）。
- [ ] AC3（能取假，makespan 改善）：拆分后 LPT 队列头 makespan 下降（不限 bucket）；（⛔ 无改善 ⇒ 假）。

## Definition of Done

可拆长文件拆分落地；AC1-3 全勾；LPT 队列头压缩（不限 bucket）；无 test()/describe() 的重构型文件不纳入本次。

## Touches

- plugin/test/ 与 packages/*/test/ 的可拆长文件（③清单中 node:test 多用例类，抽查后定）
- 拆分出的新文件
- tasks/gap-suite-split-long-multi-test-files.md（自身）
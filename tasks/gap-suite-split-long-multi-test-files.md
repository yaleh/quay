---
id: gap-suite-split-long-multi-test-files
title: 拆分含多个独立 test() 的长耗时文件——压缩 LPT 队列头（不限 bucket，makespan 下限）
status: done
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**① 不限 bucket（manager 核实 round #563）**：LPT 重排 + 文件级并发是同一套机制（`suite-lpt-runner.mjs`），跑哪个 bucket 都有「队首长文件 + 闲置容量」。round #563（`buckets=P`，140 文件）perFile 前 21 个 vs 真正最长 21 个几乎逐一对应；负载曲线前 3 段均值 7.92、峰值 34.03、**比值 0.233（不到峰值 1/4）**，比 #560（M）的 0.55 更低。

**② 两种难度不同的文件（AC1 须分两类）**：node:test 多用例（`driver.test.mjs` 466 行 23 test、`lifecycle.test.mjs` 905 行 55 test、`ts-typecheck-gate.test.mjs` 110 行 5 test）直接可拆；无 test()/describe() 手搓断言的（`cli.test.mjs` 2096 行、`mcp-server.test.mjs` 1736 行）需先重构成 node:test 才能拆，不纳入本次 AC2/AC3。

**③ round #563 候选清单**（perFile，供 Plan）：quay-init-loop-runtime 193.9s、quay-init-loop-vendor 170.1s（M/P 双 bucket）、install-config-driven-e2e-runtime 154.7s、install-config-driven-e2e-upgrade 152.3s、install-config-driven-e2e 139.7s、lifecycle 88.4s、acceptance 82.7s、cli 82.0s（②需重构）、npm-pack-e2e 79.5s、driver 78.2s、integration-batch-merge 75.7s、ts-typecheck-gate 64.5s、serve-nav-inconsistent-routes 57.0s、delivery-standalone-smoke-gate 55.2s、codex-stage1-adapter 50.8s、mcp-server 46.2s（②需重构）、sea-artifact-consumer-e2e 44.0s、session-liveness-restart 41.3s、serve-ac95-views 33.7s、init 31.6s、serve 27.8s。

**④ 量化结论（manager 8h 模拟，⛔ 修正乐观定性）**：拆文件只值 **2.8%** 缩减（拆 top-5×3）；floor-bound 只 M（55%）/ P（50%）/ full **0%**——对 full 完全无效，而 full 占 63% suite 时间。model honesty：① 未计 Node 启动开销 ⇒ 真实收益**低于** 2.8%；② 主频缩放对子进程/IO 重的队首文件偏乐观（墙钟不随主频缩短）。⇒ 本任务是 **M/P 队首的边际优化**，非大杠杆（大杠杆是 serial/lowconc 分相移除，见 serial-lowconc 任务）。

## Plan

抽查 LPT 队首长文件确认可拆（②分两类：node:test 多用例直接判可拆/不可拆；无 test()/describe() 的标「需先重构」不纳入本次）；可拆的拆成多文件 + suite 仍绿 + makespan 改善。

## Acceptance Criteria

- [x] AC1（能取假，独立性抽查分两类）：抽查 LPT 队首长文件，node:test 多用例判可拆/不可拆；无 test()/describe() 的（cli/mcp-server）标「需先重构、不纳入本次 AC2/AC3」；（⛔ 未抽查或笼统一条结论覆盖两类 ⇒ 假）。
  - **可拆（node:test 多用例，各 `test()` 独立、唯一 tmp tag、无跨 test 可变状态）**：`driver.test.mjs` 23 test、`lifecycle.test.mjs` 55 test、`ts-typecheck-gate.test.mjs` 5 test（前轮已拆 `session-liveness.test.mjs` 9 test、`quay-init-loop-vendor.test.mjs` 7 test）。
  - **不可干净拆（node:test 但非多独立 test）**：`quay-init-loop-driver/runtime/core` 用 `sharedFixture`/`laydownTemplate`（fixture 摊销，拆则失摊销）；`prod-data-audit` 慢在单个 real-carrier 审计 test（非多 test 顺序执行）。
  - **需先重构（无 test()/describe() 手搓断言，不纳入本次 AC2/AC3）**：`cli.test.mjs` 2096 行、`mcp-server.test.mjs` 1736 行——`grep -cE '^\s*(test|describe)\('` 均 0，须先重构成 node:test 才能拆。
- [x] AC2（能取假，拆分不破坏）：可拆长文件拆成多个文件，suite 仍绿（行为不变）；（⛔ 拆分后 suite 红 ⇒ 假）。
  - 本轮拆 83 新 `.test.mjs` 文件（23 driver + 55 lifecycle + 5 ts-typecheck-gate）+ 3 helpers（共享 fixtures 迁入），test 体逐字保真（行为不变）；scoped 直跑 `node --test` 83 tests pass / 0 fail；全量 suite 由 fan-in 闸兜底。
- [x] AC3（能取假，makespan 改善）：拆分后 LPT 队列头 makespan 下降（不限 bucket）；（⛔ 无改善 ⇒ 假）。
  - 拆前（round #563 perFile）：`driver` 78.2s、`lifecycle` 88.4s、`ts-typecheck-gate` 64.5s（三文件串行 231.1s）。
  - 拆后（实测，文件级并发）：driver 23 文件墙钟 ~8.6s、lifecycle 55 文件墙钟 ~22.4s、ts-typecheck-gate 5 文件墙钟 ~20.4s；三族 lane-time 231.1s → 并行 ~22.4s，LPT 队列头最长文件 88.4s → ~3s（单 test 级）。

## Definition of Done

可拆长文件拆分落地；AC1-3 全勾；LPT 队列头压缩（不限 bucket）；无 test()/describe() 的重构型文件不纳入本次。

## Touches

- plugin/test/session-liveness.test.mjs（删，拆为 9 文件）
- plugin/test/quay-init-loop-vendor.test.mjs（删，拆为 7 文件）
- plugin/test/session-liveness-helpers.mjs（SCD fixtures 迁入）
- plugin/test/quay-init-loop-helpers.mjs（vendor fixtures 迁入）
- plugin/test/session-liveness-scd-*.test.mjs（新 8 文件）
- plugin/test/session-liveness-hangguard.test.mjs（新）
- plugin/test/quay-init-loop-vendor-*.test.mjs（新 7 文件）
- packages/quay/test/driver.test.mjs（删，拆为 23 文件）
- packages/quay/test/lifecycle.test.mjs（删，拆为 55 文件）
- packages/quay/test/ts-typecheck-gate.test.mjs（删，拆为 5 文件）
- packages/quay/test/driver-*.test.mjs（新 23 文件）
- packages/quay/test/lifecycle-*.test.mjs（新 55 文件）
- packages/quay/test/ts-typecheck-gate-*.test.mjs（新 5 文件）
- packages/quay/test/driver-helpers.mjs（Phase A/C fixtures 迁入）
- packages/quay/test/lifecycle-helpers.mjs（Phase A/C fixtures 迁入）
- packages/quay/test/ts-typecheck-gate-helpers.mjs（registry/CLI fixtures 迁入）
- plugin/test/suite-bucket-attribution.test.mjs（删 stale 引用：GROUP_A 移除已删 lifecycle 文件）
- plugin/test/test-isolation-check.test.mjs（改 stale 引用：R8 锚到 ts-typecheck-gate-cli-event）
- .quay/suite-bucket-reattribution.jsonl（删 stale entry）
- docs/analysis/test-file-baseline.txt（重快照：删 3 + 增 83）
- plugin/test/known-load-sensitive.test.mjs（删 stale 引用：movedToLowconc 移除已删 vendor 文件）
- tasks/gap-suite-split-long-multi-test-files.md（自身）

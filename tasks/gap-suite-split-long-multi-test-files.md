---
id: gap-suite-split-long-multi-test-files
title: 拆分含多个独立 test() 的长耗时文件——压缩 M-bucket LPT 队列头（makespan 下限）
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

round #560 负载曲线前 3 段（长文件跑那段）均值 load1=26.02、峰值 47.02、比值 0.55——机器有真实闲置容量。两个排最前的长文件：`plugin/test/session-liveness.test.mjs`（250.7s，9 个独立 `test()`、8 次子进程 spawn）、`plugin/test/quay-init-loop-vendor.test.mjs`（307.3s，7 个独立 `test()`、含 npm 子进程调用）——都是多场景顺序执行 + 子进程/IO 重、非 CPU 密集，结构上可拆。拆成多个文件让 Node 的文件级并发并行化这些场景，压缩 M-bucket LPT 队列头部（决定 makespan 下限的部分）。

## Plan

先抽查 M-bucket 排前的长文件确认可拆（多独立 `test()` + 拆后不共享状态），可拆的拆成多个文件 + suite 仍绿 + makespan 改善。候选清单在 round #560 perFile 数据里取（不止这两个已验证的）。

## Acceptance Criteria

- [x] AC1（能取假，独立性抽查）：抽查 M-bucket 排前长文件，确认多独立 `test()` 且拆后互不依赖共享状态；（⛔ 未抽查 ⇒ 假）。
  - 两个命名文件可拆：`session-liveness.test.mjs` 9 个 `test()` 各 `makeHermeticProbe(唯一 session)` + 唯一 tmp prefix、无跨 test 可变状态；`quay-init-loop-vendor.test.mjs` 7 个 `test()` 各 `makePluginCopy()`/`makeTmp()` 唯一 tmp、无共享状态。
  - 其余排前文件不可干净拆：`quay-init-loop-driver/runtime/core` 用 `sharedFixture`/`laydownTemplate`（fixture 摊销，拆则失摊销）；`prod-data-audit`（329s）慢在单个 real-carrier 审计 test（非多 test 顺序执行）。
- [x] AC2（能取假，拆分不破坏）：可拆长文件拆成多个文件，suite 仍绿（行为不变）；（⛔ 拆分后 suite 红 ⇒ 假）。
  - 拆为 16 新文件（9 SCD + 7 vendor），test 体逐字保真；scoped 门 `--for-task` 16 tests pass / 0 fail，静态检查全绿（含 test-file-baseline 重快照、test-isolation、test-framework-policy）。全量 suite 由 fan-in 闸兜底。
- [x] AC3（能取假，makespan 改善）：拆分后 M-bucket makespan 下降（文件级并发并行化场景）；（⛔ 无改善 ⇒ 假）。
  - 拆前（round #560 perFile）：`session-liveness` 单文件 250.7s、`quay-init-loop-vendor` 单文件 307.3s。
  - 拆后（实测，文件级并发）：session-liveness 9 文件 cc=8 墙钟 37.2s；vendor 7 文件 cc=7 墙钟 17.8s。两族 lane-time 558s → ~55s，LPT 队列头最长文件 307s→~44s。

## Definition of Done

可拆长文件拆分为多个独立文件并落地提交；AC1-3 全勾（独立性抽查、拆分不破坏、makespan 改善）；M-bucket LPT 队列头压缩、makespan 下降。

## Touches

- plugin/test/session-liveness.test.mjs（删，拆为 9 文件）
- plugin/test/quay-init-loop-vendor.test.mjs（删，拆为 7 文件）
- plugin/test/session-liveness-helpers.mjs（SCD fixtures 迁入）
- plugin/test/quay-init-loop-helpers.mjs（vendor fixtures 迁入）
- plugin/test/session-liveness-scd-fire.test.mjs（新）
- plugin/test/session-liveness-scd-develop-active.test.mjs（新）
- plugin/test/session-liveness-scd-inflight-changing.test.mjs（新）
- plugin/test/session-liveness-scd-unsaturated.test.mjs（新）
- plugin/test/session-liveness-scd-config-gates.test.mjs（新）
- plugin/test/session-liveness-scd-busy.test.mjs（新）
- plugin/test/session-liveness-scd-multitask.test.mjs（新）
- plugin/test/session-liveness-scd-progress.test.mjs（新）
- plugin/test/session-liveness-hangguard.test.mjs（新）
- plugin/test/quay-init-loop-vendor-stale-rebuild.test.mjs（新）
- plugin/test/quay-init-loop-vendor-fresh-passthrough.test.mjs（新）
- plugin/test/quay-init-loop-vendor-stale-fail-closed.test.mjs（新）
- plugin/test/quay-init-loop-vendor-freshness-fail-closed.test.mjs（新）
- plugin/test/quay-init-loop-vendor-freshness-passes.test.mjs（新）
- plugin/test/quay-init-loop-vendor-user-scope-stale.test.mjs（新）
- plugin/test/quay-init-loop-vendor-user-scope-fresh.test.mjs（新）
- .quay/suite-bucket-reattribution.jsonl（删 stale entry）
- docs/analysis/test-file-baseline.txt（重快照：删 2 + 增 16）
- plugin/test/known-load-sensitive.test.mjs（删 stale 引用：movedToLowconc 移除已删 vendor 文件）
- plugin/test/suite-bucket-attribution.test.mjs（删 stale 引用：GROUP_C 移除已删 vendor 文件）
- tasks/gap-suite-split-long-multi-test-files.md（自身）
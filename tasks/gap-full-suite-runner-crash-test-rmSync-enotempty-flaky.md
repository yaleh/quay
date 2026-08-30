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

`plugin/test/full-suite-runner.test.mjs` AC6/AC4 crash 测试的 teardown `rmSync` 撞 `ENOTEMPTY`：runner 崩溃路径 spawn 一个 DETACHED `suite-load-sampler.ts`，它启动即写 `<root>/.quay/suite-load-<runId>.jsonl.pid`（pid sidecar），而崩溃路径 `process.exit` 从不收割/停掉它。负载下 sampler 的延迟 `.pid` 写落在 teardown `rmSync` 期间——rmSync 已 rmdir `.quay` 后 sampler 又 `mkdir -p` 回 `.quay`，`rmdir(root)` 即 ENOTEMPTY。随机挡任意任务 fan-in（实证 gap-suite-lpt 3 次 fan-in 2 次 suite red 均此条）。@test-group lowconc，非任何任务 Touches。

**根因取证（推翻旧假说「孤儿 suite 子进程 cwd 占位」）**：① detached 子进程 cwd=dir 不阻 rmdir（干净探针：spawn detached `sleep 3` cwd=dir 后 rmSync 秒成）；② 363 个遗留 `/tmp/fsr-crash-*` 目录，每个恰含一个 `suite-load-*.jsonl.pid`——正是 sampler 的 pid sidecar，非任何 suite 子进程产物。

## Plan

teardown `rmSync` 加 `maxRetries=20/retryDelay=100`（线性退避 ≤ ~21s）：等 sampler 的一次性 `.pid` 写落盘后 re-list 并删除被重建的 `.quay`，消除 ENOTEMPTY 竞态（sampler 首次 state 检查即见 red 退出，`.pid` 写是一次性的）。

## Acceptance Criteria

- [x] AC1（能取假）：teardown 不再撞 ENOTEMPTY（rmSync 重试）；（⛔ 仍 ENOTEMPTY ⇒ 假）。（实证：bare rmSync 根因 = sampler `.pid` 写竞态；加 retry 后 AC6 单测 30 连跑 0 ENOTEMPTY、AC4 10 连跑 0 fail）
- [x] AC2（能取假，负载）：16-lane 满负载下 AC6 crash 测试多次无 ENOTEMPTY flaky。（实证：8 CPU burner 负载下 AC6 20 连跑 0 ENOTEMPTY；上轮全量 fan-in suite 16-lane 下 AC6 绿 868ms）

## Definition of Done

teardown 竞态消除（rmSync maxRetries=20/retryDelay=100 等 sampler `.pid` 写落盘后 re-list 删除重建的 `.quay`）；AC1-AC2 全勾；全量 suite 绿；fan-in 不再被此 ENOTEMPTY flaky 随机挡。

**旁证（非本任务范围，供 outer 立案）**：上轮 fan-in suite red 的根因不是本任务 ENOTEMPTY，而是另一条 flaky——`plugin/test/writestate-atomicity-split.test.mjs:111` negative control「in-place writeFileSync IS observably torn」`assert.ok(torn > 0)` 在 16-lane 满负载下读者采样漏掉 4MB 写窗 ⇒ `torn === 0` 误红。同属 writestate-atomicity flaky 族（`gap-writestate-atomicity-liveness-assertion-flaky` 已 done 但只放宽了 liveness 断言，负对照的 `torn > 0` 未处理）。非本任务 Touches。

## Touches

- plugin/test/full-suite-runner.test.mjs（teardown rmSync maxRetries/retryDelay + 根因注释更正）
- tasks/gap-full-suite-runner-crash-test-rmSync-enotempty-flaky.md（自身）

---
id: gap-suite-file-split-two-longest
title: 机械拆分 full-suite-runner.test.mjs + worker-driver.test.mjs 各 2–3 份——让任何 shard ≤139s（Tier 2）
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

`full-suite-runner.test.mjs`（~199s）+ `worker-driver.test.mjs`（~157s）是全套件最长两文件，同处 lowconc 泳道（并发 8）把地板顶到 ~199.1s（idealSplit=139.1s）。每轮 `__CEILING__` 机械标两文件「封顶者/该拆」且已落盘 verification-round.jsonl，任务库无对应 gap。机械拆分两文件各 2–3 份，让任何 shard ≤139s：拆 full-suite-runner 后 lowconc floor→157s，两文件都拆后 floor→139.1s。配合 Tier 1 的内部削减（任务 1–5），上限 ~60s/轮。

**⛔ 边界**：不删测试换时间（每测一条 AC，flip-no-ac 闸守着）；不移两文件去 main 泳道（净省更少且违背「governance 迁出 main」load 语义裁定）。

## Plan

1. 抽 harness（fakeSuite / runRunner / waitExit / poll / readState / GREEN_SUITE / PHASE_SUITE / _runnerLockDirs 清理，~90 行）到 `plugin/test/helpers/full-suite-runner-harness.mjs`（单一来源防 drift，⛔ 多份拆分文件各复制一份）。
2. 两文件各拆 2–3 份（按测试主题/机制分组，⛔ 不改变任何测试断言）。full-suite-runner 按区段拆：`full-suite-runner.test.mjs`（~60 test）+ `full-suite-runner-phases.test.mjs` + `full-suite-runner-cgroup.test.mjs`。
3. 拆分产物补 `@test-group` + Touches 注册；ratchet/baseline 同步（若拆改 @test-group 触发）。

## Acceptance Criteria

- [ ] AC1（能取假）：任何 shard 墙钟 ≤139s——grep __PERFILE__ 无 shard 超过 139s（贴拆分后各 shard 时长）；（⛔ 仍有 >139s shard ⇒ 假）。
- [ ] AC2（能取假）：lowconc 泳道 floor 较基线下降（199.1s → 139.1s 方向），贴前后 floor 读数；（⛔ 无下降 ⇒ 假）。
- [ ] AC3（能取假）：拆分后全量 suite 绿、测试断言总数不减（⛔ 不删测试换时间）；（⛔ 少测/红 ⇒ 假）。

## Definition of Done

两文件机械拆分落地（shard ≤139s）；AC1-AC3 全勾；全量 suite 绿；floor 较基线下降。

## Touches

- plugin/test/helpers/full-suite-runner-harness.mjs（新，harness 单一来源）
- plugin/test/full-suite-runner.test.mjs（拆：~60 test 保留）
- plugin/test/full-suite-runner-phases.test.mjs（新，@test-group lowconc）
- plugin/test/full-suite-runner-cgroup.test.mjs（新，@test-group lowconc）
- plugin/test/worker-driver.test.mjs（拆 2–3 份）
- tasks/gap-suite-file-split-two-longest.md（自身）

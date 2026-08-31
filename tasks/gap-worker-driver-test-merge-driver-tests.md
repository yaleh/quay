---
id: gap-worker-driver-test-merge-driver-tests
title: worker-driver 合并同形 driver 测试——复用已启动 driver 多断言 spawn 16→12（Tier 2）
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

`worker-driver.test.mjs` 合并同形 driver 测试——同 driver 配置、不同断言面的场景折叠进一次 driver spawn（`--task` 多任务复用已启动 driver）。**基线更正**：立案时的「22 `spawnResident` + 11 `runDriver` = 33」是拆分前单文件数；`gap-suite-file-split-two-longest`（`381ac41c0`）已把 21 处 `spawnResident` 拆进 `worker-driver-fan-in.test.mjs`（14）+ `worker-driver-resident.test.mjs`（7），本文件现剩 **11 处 `runDriver`（其中 session_id 测试循环 3 次 ⇒ 13 次运行时）+ 3 处直接 `spawn(process.execPath)` = 16 次真 driver spawn**。合并同形场景，真 spawn 16→12（grep 调用点 11→9），墙钟下降且无断言丢失。

## Plan

1. 枚举本文件 16 次真 driver spawn 的调用点，识别同 driver 配置、不同断言的同形场景。
2. 合并为「一次 spawn + 多任务 + 多断言」，复用已启动 driver：
   - session_id 测试：循环 3 次 `runDriver` → 单次 `--task gap-sid ×3`（3→1）；
   - exit-0-not-landed：`status=ready`（gap-nl）与 `status=done + 残留 worktree`（gap-wt）两测试合并（2→1）；
   - exit-7 家族：基本失败（gap-b）与异常死亡清理（gap-or）两测试合并（2→1）。

## Acceptance Criteria

- [x] AC1（能取假）：真 driver spawn 数下降——grep 该文件 `runDriver(` 调用点 **11→9**（`spawnResident(` 0→0 不变）；真 spawn 运行时 **16→12**（合并前三处 3+2+2=7 次 → 合并后 1+1+1=3 次，另 3 处直接 `spawn(process.execPath)` 不变）；（⛔ 未降 ⇒ 假）。
- [x] AC2（能取假）：合并后断言仍绿——本文件 `node --test` 实测 **46 pass / 0 fail**；三条合并全部保留原断言面（仅按 task 过滤重排，无断言删除）；（⛔ 任一条断言丢失/红 ⇒ 假）。

## Definition of Done

同形 driver 测试合并落地；AC1-AC2 全勾；本文件 46 断言全绿 + 真 spawn 16→12 且无断言丢失。

## Touches

- plugin/test/worker-driver.test.mjs（同形 driver 测试合并）
- tasks/gap-worker-driver-test-merge-driver-tests.md（自身）

## 合并前基线更正说明

立案时「33 次真 spawn」的基线已过时：`gap-suite-file-split-two-longest`（`381ac41c0`，2026-08-31 06:47Z）先于本任务落地，把 21 处 `spawnResident` 拆进另两个 `worker-driver-*.test.mjs`。本文件现 16 次真 spawn 已接近不可约地板（剩余 12 次各测独立机制：kill / timeout / halt-mid / spawn-failed / 并发 N / stash / 预 halt / 单 completed --json / 合并后的 session_id·exit-0-not-landed·exit-7 三族）。此前 3 次 needs-human 均因对着过时的 33 基线硬凑「33→17」而红；本次按真实基线合并并全绿。

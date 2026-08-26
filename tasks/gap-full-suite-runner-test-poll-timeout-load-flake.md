---
id: gap-full-suite-runner-test-poll-timeout-load-flake
title: full-suite-runner.test.mjs poll(5000ms) 高负载下超时 flake + 文件未入 known-load-sensitive 致 fix-scope gate 误判确定性失败（defer anti-livelock）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-suite-lpt-lookback-not-bucket-filtered` 的 fan-in 走到全量 suite 阶段被一个【与本任务无关】的红挡下（defer anti-livelock 3 轮纯 defer escalate → needs-human）。

**唯一失败文件**：`plugin/test/full-suite-runner.test.mjs`（__PERFILE__ duration_ms=706947 ≈ 11.8min，__CEILING__ 封顶者/该拆），3 个子测试同形失败 `Error: poll timeout after 5000ms`：
```
:2402 "AC1 — while the suite runs, state=running..." 
:2429 "AC2 — RED is marked on first failure detection..."
:3116 "AC2 — a vitest structured failure line flips red EARLY..."
```

**根因（task-worker 读码 + outer 复核）**：这 3 个测试用 `poll(fn, {timeoutMs: 5000})`（`full-suite-runner.test.mjs:282` 默认 timeoutMs=5000、:287 超时 reject）+ fake suite `sleep 2`。本轮 load=11.81、lane_count=16 全满 ⇒ 5s 轮询上限在高负载下不够（进程 spawn 争抢使 fake suite 慢于 5s）⇒ 3 次 relaunch 同 3 测试全红（确定性于当前 load）。

**⊢ triage 缺口（第二个问题）**：`full-suite-runner.test.mjs` **不在 known-load-sensitive.ts 家族**（`known-load-sensitive.ts --kind` 返回空）⇒ fix-scope gate 把它当 other-task（确定性失败）而非 load-sensitive ⇒ 走 defer anti-livelock（3 轮纯 defer）而非 release/isolate-rerun。该文件本质是 load-sensitive（poll 5s 在高负载下必超时），但没被这个家族登记。

**⊢ lpt-lookback 自身无碍**：scoped 绿（suite-lpt-order.test.mjs 14/14），AC1-AC3 已勾，develop 未含其修复；纯被这个无关 load-flake 挡。

## Plan

1. **修 flake**：增加 poll timeout（5000ms → 更长，或 load-aware），使高负载下不再 5s 超时。
2. **修 triage**：把 `full-suite-runner.test.mjs` 纳入 known-load-sensitive.ts（或修 fix-scope gate 对该文件/该 poll 模式的判定），使它的失败被隔离重跑而非当确定性失败 defer。
   ⛔ 收编/标记前先隔离重跑证明「隔离下绿」= load-sensitive（C15 纪律），⛔ 不凭「5s 超时」这一条就断定。

## Acceptance Criteria

- [ ] AC1（能取假，poll 不再超时）：高负载下 full-suite-runner.test.mjs 的 poll 不再 5000ms 超时（timeout 上调或 load-aware）；（⛔ 仍 5000ms 超时 ⇒ 假）。
- [ ] AC2（能取假，triage 正确）：full-suite-runner.test.mjs 的失败被 fix-scope gate 判为 load-sensitive（走 isolate-rerun）而非确定性 other-task（defer anti-livelock）；（⛔ 仍判 other-task ⇒ 假）。

## Definition of Done

poll timeout 上调 + 文件纳入 load-sensitive 家族；AC1-AC2 全勾；高负载下不再 5000ms 超时、失败被正确隔离重跑。

## Touches

- plugin/test/full-suite-runner.test.mjs（poll timeout 上调/load-aware）
- plugin/scripts/known-load-sensitive.ts（纳入 full-suite-runner.test.mjs，若走该方向）
- plugin/test/（load-sensitive 隔离重跑负控制）
- tasks/gap-full-suite-runner-test-poll-timeout-load-flake.md（自身）

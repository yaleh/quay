---
id: gap-retire-outer-monitors-after-reconciler
title: 协调循环（任务1-4）落地后退役 outer 两个 Monitor（slot-free-trigger /
  suite-state-trigger，从正确性依赖降级为优化后移除）
status: done
labels:
  - gap
parent: null
children: []
depends_on:
  - gap-worker-driver-reconcile-interval
  - gap-worker-driver-async-selector-readypool
extra: {}
---
**type:** execution

## Proposal

`slot-free-trigger.ts` / `suite-state-trigger.ts` 两个 trigger 现在挂在 outer 会话的 Monitor 上（orchestrator-loop-tick.md:274/:293），是正确性依赖。但今日实测其宿主（Monitor = outer 会话）**已被证伪**：tmux server 重置杀 outer ⇒ 静默消失。协调循环（reconciler + 定时器地板，任务 1-4）落地后，「空槽出现」与「套件转红」都由 driver 每趟 pass 现读（ready 池 / suite state），两个 trigger 从正确性依赖降级为优化（SPEC §5.5）。

## Plan

任务 1-4 落地并验证后，退役这两个 trigger 的 Monitor 挂载（从 outer tick 冷启动 4b2 步骤移除），trigger 脚本本身随之地为冗余（保留实现/测试或移除，按当时判断）。

## Acceptance Criteria

- [x] AC1（能取假，前置满足）：退役动作发生在任务 1-4 落地之后（⛔ 1-4 未全落地即退役 ⇒ 假——会撤掉仍在岗的正确性依赖）。
  - depends_on 两任务 `gap-worker-driver-reconcile-interval` / `gap-worker-driver-async-selector-readypool` 均 `status: done`；
  - `worker-driver.ts` 已含协调地板（`--reconcile-interval`，:1056/:1743）与异步 selector/readyPool（`runSelectorWorker`/`readyPoolCheck` async spawn，:1371/:1440）——SPEC §5.8 第 3/4 步落地在先。
- [x] AC2（能取假，等价性）：退役后，构造「空槽出现」与「套件转红」场景，断言协调循环（driver 地板 + 每趟 pass）在 N 秒内接管响应（⛔ 事件无人响应 ⇒ 假）。
  - 「空槽出现」接管：`plugin/test/worker-driver.test.mjs` AC2（`gap-worker-driver-reconcile-interval`）——worker 全挂起（边沿事件全丢）时，地板 `--reconcile-interval 1` 仍每 ≤N 秒重跑 ready 池并在 N 秒内派发（carrier = `worker-round.jsonl`，非 `--json`）。退役的 `slot-free-trigger` Monitor 本就是把同一空槽条件事件化，现由 driver 每趟 pass 现读 ready 池直接派发。
  - 「套件转红」接管：外层红窗分诊本身已随 AC84 退役（→ `orchestration/archive/AC58-retired-clauses.md#R33`），`SUITE-RED` 的外层消费者已不存在；套件红现由内层每 tick 现读 `.quay/full-suite-state.json`（fast-mode-tick-core A9，red+failed ⇒ 暂缓 fan-in + 条件化停派）承接。`suite-state-trigger.ts` 本体保留为共享库——`full-suite-runner.ts` 仍 import `runOnce`/`isRunnerInFlight`（crash-watchdog 写终态 red、起跑闸、红链自检 `--fail-fast-check`），`suite-state-trigger.test.mjs` 全绿覆盖该链。

## Definition of Done

任务 1-4 落地后，两个 outer Monitor 挂载移除，空槽/套件红场景由 driver 协调循环接管（AC2 复现），正确性无回归。
- 两个 Monitor 挂载移除：`plugin/loop/orchestrator-loop-tick.md`（4b2/4b3 产品行为正本）+ `orchestration/orchestrator-loop-tick.md`（4b2 本层实例副本）冷启动步骤替换为退役说明；「每 tick 必报」的套件/空槽触发者挂载行删除。
- 同步退役引用：`orchestration/orchestrator-tick-core.md` + `plugin/loop/orchestrator-tick-core.md`（两份 byte-identical）A18/B9 的 `SLOT-FREE` 事件驱动分支替换为退役指针（保留 `src:` 覆盖 50/50）。
- trigger 脚本冗余标记：`slot-free-trigger.ts` / `suite-state-trigger.ts` 头注释加「⛔ 退役」段（Monitor 挂载移除，脚本本体保留——suite-state 仍作共享库被 full-suite-runner import）。
- 测试同步：`slot-free-trigger.test.mjs` AC3 改断言退役（driver 接管）；`suite-state-trigger.test.mjs` AC1 补退役/共享库断言。套件全绿无回归。

## Touches

- orchestration/orchestrator-loop-tick.md（4b2 移除 Monitor 挂载）
- plugin/loop/orchestrator-loop-tick.md（4b2/4b3 产品行为正本——两挂载本体的正本，Touches 原始列表漏列，硬规则 5b）
- orchestration/orchestrator-tick-core.md（同步退役引用）
- plugin/loop/orchestrator-tick-core.md（byte-identical 副本，同步退役引用）
- plugin/scripts/slot-free-trigger.ts（冗余标记）
- plugin/scripts/suite-state-trigger.ts（冗余标记）
- plugin/test/slot-free-trigger.test.mjs（AC3 改断言退役）
- plugin/test/suite-state-trigger.test.mjs（AC1 补退役断言）
- tasks/gap-retire-outer-monitors-after-reconciler.md（自身）
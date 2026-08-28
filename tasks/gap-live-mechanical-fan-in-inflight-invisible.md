---
id: gap-live-mechanical-fan-in-inflight-invisible
title: Live 页机械 fan-in 在飞任务不可见——round 只带 count 不带 task id，三载体在 fan-in 窗口全 miss
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

正在走机械 fan-in 的任务在 Live 页不显示（在飞列表里完全消失）。根因（已验证到行号级）：`packages/quay/src/observation.ts` 的 `readLive()` 在飞集合只认三个载体，机械 fan-in 期间三个全部 miss：

1. **workflow-events 配对**：机械 driver 从不写 task-start（`worker-driver.ts` 无任何 `.workflow-events` 写入，实测最新事件文件停在 08-24/25）。
2. **outcome.jsonl 起止配对**：记录只在 `worker-driver.ts:1387` `finish()` 一次性写，而 `finish()` 排在 `runMechanicalFanIn`（`:1411`）之后 ⇒ fan-in 期间盘上无该 run 的 outcome。
3. **/proc 扫描 quay-task-worker + Task:**：worker 实现完即 exit，进程已消失；跑 fan-in 的是 driver 进程，cmdline 不含 quay-task-worker。

driver 自己知道任务在飞（`worker-driver.ts:1811` `inFlightTasks()`，running 集合，本就被派发过滤用），round 心跳也写 `in_flight:1`，但 `computeWorkerRoundRecord`（`:761`）不带 task id，`readLive` 只把 round 用于 `workerDriverOnlineMs`/`workerDriverActive`。

**实证（2026-08-28 真实发生）**：`gap-full-suite-lock-hold-watchdog-threshold-shorter-than-fan-in`（wk-prod-1787900977，07:34:55→08:02:22 exited-not-landed）。`fan-in-workflow-lock-events.jsonl` 显示 07:50:35 acquire→08:02:22 release，这 12 分钟即 worker 已 exit、driver 跑 suite 的机械 fan-in 窗口；窗口内无 worker 进程、无 outcome、无 workflow-events，round 心跳 07:53/07:58 只写 count 不写 id ⇒ Live 页显示「无在飞任务」12 分钟。

**dedup**：`gap-live-page-worker-driver-inflight-invisible`（done）修的是「worker-driver 完全隐形」（readLive 只读 workflow-events），本任务是其后续缺口——round 已用于在线状态，但**不带 task id**，机械 fan-in 窗口的具体任务仍隐形。

## Plan

最小改动，复用现有载体：

1. `worker-driver.ts`：`computeWorkerRoundRecord` 加 `in_flight_tasks: string[]` 字段，`writeRound`（`:1816`，闭包内可直接调）传 `inFlightTasks()`（含实现中 + fan-in 任务）。
2. `observation.ts` `readLive`：在 outcome 块（`:973-981`）与 /proc 循环（`:990-1009`）之间读最新一条 round 的 `in_flight_tasks`，映射为 `InFlightTask`（pid null）推入 `workerInFlight`。顺序 outcome→round→/proc（/proc 最后 ⇒ 实现中任务保 pid/transcript 可点）。既有 `:1049` done 状态过滤自动清落地任务防 round 快照陈旧。

## Acceptance Criteria

- [x] AC1（能取假，生产载体）：读生产 round 载体，`in_flight_tasks` 非空时 `readLive().inFlight` 含该 task（⛔ round 无 task id / readLive 不含 ⇒ 假）。
- [x] AC2（不误伤）：workflow-events-only fixture（无 round 文件）的既有 serve.test.mjs AC2 不受影响。

## Definition of Done

round 记录带 `in_flight_tasks`（task id）；readLive 把其映射进 inFlight；AC1-AC2 全勾；机械 fan-in 窗口任务在 Live 页可见。

## Touches

- plugin/scripts/worker-driver.ts（computeWorkerRoundRecord 加 in_flight_tasks + writeRound 传 inFlightTasks）
- packages/quay/src/observation.ts（readLive 读 round in_flight_tasks 推入 workerInFlight）
- packages/quay/test/serve.test.mjs（AC1 生产载体断言 + AC2 不误伤）
- tasks/gap-live-mechanical-fan-in-inflight-invisible.md（自身）

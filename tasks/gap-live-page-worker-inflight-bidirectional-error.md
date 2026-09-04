---
id: gap-live-page-worker-inflight-bidirectional-error
title: /live 页在飞可见性双向错误（workerOutcomeOpen 终态排除不全 + 无派发时进程信号）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

/live 页（gap-live-page-worker-driver-inflight-invisible 建）的在飞可见性**双向都错**（manager 2026-08-24 实测，直接量）。根因：`workerOutcomeOpen()`（packages/quay/src/observation.ts:579）终态排除名单不全——只排除 completed/spawn-failed/not-dispatched 3 个，`exited-not-landed`（真实失败终态）不在名单 ⇒ 死任务永久误判「在飞」。

**方向一（误报死任务还活着，实测复现）**：stopReason-latch worker 一小时前已被 destroy-path 销毁（分支+worktree 全没），但 /live 两次实测（11:39/11:44）都显示它「实现中」，待落地时长 105.8→128.0min 永远涨（直到重派产生新记录）。原理：其最后 worker-outcome 记录 final_state=exited-not-landed 不在排除名单 ⇒ workerInFlightTasks() 当 open。

**方向二（漏报真在飞任务，已核实）**：真实在飞 6 worker（ps 观测），/live 只显示 3 个（有旧记录的），漏 3 个首次派发（lpt-dual-process/usage-line/webui-detail）——worker-outcome.jsonl 只在完成时写记录，workerInFlightTasks() 遍历已有记录 map，天然看不到零记录任务。

## Plan

两方向分别修：①误报——`workerOutcomeOpen()` 改白名单（只有明确「运行中」信号算 open），或列全终态（completed/spawn-failed/not-dispatched/exited-not-landed/failed/timed-out）全排除。②漏报——加独立于 worker-outcome 完成记录之外的「进程在跑」信号（ps//proc 匹配 `Task: <id>`，或 worker-driver 派发时写 dispatch-started 标记）。

## Acceptance Criteria

- [x] AC1（能取假，误报方向）：终态 worker（exited-not-landed/failed/timed-out）不再显示在 /live 在飞列表（⛔ 死任务仍显示「实现中」⇒ 假）。
- [x] AC2（能取假，漏报方向）：首次派发（无 worker-outcome 记录）的 worker 出现在 /live 在飞列表（⛔ 零记录任务看不到 ⇒ 假）。

## Definition of Done

双向修正落地 develop；AC1-2 全勾；一个被销毁的 worker 不再显示在飞（AC1），一个首次派发的 worker 显示在飞（AC2）。

## Touches

- packages/quay/src/observation.ts（workerOutcomeOpen 白名单/列全终态 + workerInFlightTasks 加进程信号）
- packages/quay/test/observation.test.mjs（或对应测试）
- tasks/gap-live-page-worker-inflight-bidirectional-error.md（自身）
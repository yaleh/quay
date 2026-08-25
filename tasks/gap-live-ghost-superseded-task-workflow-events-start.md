---
id: gap-live-ghost-superseded-task-workflow-events-start
title: /live 页孤儿 workflow-events START 事件永久显示 superseded/done 任务「实现中」——inFlight 来源无 status 过滤
status: todo
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

`/live` 页把 `gap-worker-driver-periodic-exit-resident`（status 已 `superseded`、无存活进程、最后 outcome 12:20:46Z 已结束）仍显示为「实现中」（curl 实测 `runId=fm-...cv7uzd pid=— sessionId=— 194.5 分钟 实现中`）。`pid=—` 说明它来自 `.workflow-events/` 的旧 telemetry START-without-END 配对（`fm-` 前缀），非 `/proc` 活进程。

**根因（`packages/quay/src/observation.ts:915 readLive`，已核实）**：
1. `workerOutcomeOpen()` 恒返回 false（:645-647，注释自述「outcome carrier 只在 END 写，永远无法信号一个仍在跑的 worker」）⇒ workerInFlight（worker-outcome 来源）恒空——这是设计好的「活信号只认 /proc」；
2. `inFlight`（.workflow-events/ 来源，pairInFlight 配对）只过两道滤：`taskWorktreeOpen !== false`（worktree 还在）+ `startedAtMs >= workerOnlineMs`（比 driver 上线晚）——本任务两道都过不掉（worktree 还在、08:47 起晚于 driver 上线）；
3. 合并逻辑（:1020-1034）只对 workerInFlight 条目查 `readTaskStatusOnDisk(...)==='done'` 排除，**对 workflow-events 来源的 inFlight 条目完全无 status 过滤**——这是唯一的洞。

⇒ 一条孤儿 START 事件（worker session 在没写 fan-in 正常收尾 telemetry 时被终止/superseded），只要 worktree 未清理，就永久显示「实现中」，不随任务翻 done/superseded/needs-human 消失。

## Plan

给 workflow-events 来源的 `inFlight` 也加 status 过滤：`readTaskStatusOnDisk(root, t.taskId)` 命中终态集合（`done`/`superseded`，`needs-human` 视语义也可排除——它不代表任何 worker 正在跑）就剔除，与 workerInFlight 现有过滤对齐并扩大覆盖。`Task.status` 枚举在 `abi.ts:9`。

## Acceptance Criteria

- [ ] AC1（能取假，终态剔除）：一个 status=superseded/done 且有孤儿 START 事件的任务，在 /live 不再显示「实现中」；（⛔ 仍显示 ⇒ 假）。
- [ ] AC2（能取假，负控制）：一个真在飞任务（status=ready + 活 worker）仍显示「实现中」（不被误剔）；（⛔ 误剔 ⇒ 假）。
- [ ] AC3（能取假，needs-human 语义）：needs-human 任务（无活 worker）不显示「实现中」（若采纳排除 needs-human）或明确记录为何保留；（⛔ 语义不决 ⇒ 假）。

## Definition of Done

workflow-events 来源 inFlight 加终态 status 过滤；AC1/AC2/AC3 全勾；curl /live 对 superseded 任务不再显示「实现中」。

## Touches

- packages/quay/src/observation.ts（readLive 的 inFlight 合并加 status 过滤）
- packages/quay/test/ 或 plugin/test/（/live 幽灵负控制测试）
- tasks/gap-live-ghost-superseded-task-workflow-events-start.md（自身）

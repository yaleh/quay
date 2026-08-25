---
id: gap-task-detail-runs-block-inflight-session-link
title: /task/<id> 任务详情页 Runs 表对「正在跑」盲（只读 worker-outcome END-only），缺 /live 那样的在飞 session 链接
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

`/task/<id>` 详情页 Runs 区块对「正在跑」状态是盲的。人报「/live 能点会话链接，任务详情页（gap-ac148）没有」。根因（已核实）：
- `taskRunsBlock`（`serve-task.ts:434`）唯一数据源是 `.quay/worker-outcome.jsonl`，而该 carrier **只在 worker END 时写一行**（observation.ts 注释原话「written only at worker END」）——gap-ac148 当前这一轮 worker（pid 2089875）从未退出过（含它自己 ff 失败重试的 revert，全程同一进程），结构上不可能有记录，`taskRunsBlock` 对「正在跑」盲；
- `/live` 能点链接走的是另一条路：`readLive` 对活跃 worker 做 `/proc` 扫描 + `liveSessionIdForPid(pid, sessionHome)` join `~/.claude/sessions/<pid>.json`——这是 `gap-worker-task-transcript-access-webui` 的 AC2 加的，但 **AC2 原文只写「/live 在飞任务」，从未覆盖 `/task/<id>`**；`gap-webui-task-runs-block` 也只验证了 worker-outcome 字段读取。⇒ 两个 done 任务各自 AC 都满足，缺口在两者交集从未被要求过。

## Plan

`taskRunsBlock` 复用已存在的 `liveSessionIdForPid`（observation.ts:757）：若 `/proc` 扫描到该 taskId 对应的活 worker pid，在 Runs 表顶部加一行「进行中」（pid + session 链接），历史 worker-outcome 行不变——与 `readLive` 里 workerInFlight 的处理对称，无需新写 join 逻辑。

## Acceptance Criteria

- [ ] AC1（能取假，在飞可见）：`/task/<id>` 对一个正在跑的任务（worker 活）显示「进行中」行（含 session 链接）；（⛔ 仍只显示「无 worker 运行记录」⇒ 假）。
- [ ] AC2（能取假，负控制）：一个 done 任务（无活 worker）不显示「进行中」行（只显示历史 worker-outcome 行，无幻影）；（⛔ 出现幻影「进行中」⇒ 假）。
- [ ] AC3（能取假，链接可点）：该 session 链接复用 `liveSessionIdForPid`，点开能看到 transcript（与 /live 一致）；（⛔ 链接死/不可点 ⇒ 假）。

## Definition of Done

`taskRunsBlock` 复用在飞 session 关联；AC1/AC2/AC3 全勾；`/task/<id>` 在飞任务显示「进行中」session 链接、done 任务无幻影。

## Touches

- packages/quay/src/serve-task.ts（taskRunsBlock 复用在飞 pid→sessionId join）
- packages/quay/src/observation.ts（如需暴露 liveSessionIdForPid 的复用入口）
- packages/quay/test/（taskRunsBlock 在飞/负控制测试）
- tasks/gap-task-detail-runs-block-inflight-session-link.md（自身）

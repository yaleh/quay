---
id: gap-live-ghost-inflight-paused-event
title: Live 幽灵在飞——worktree 释放未写收尾事件（⛔ 事件模型无非正常终结态）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager web 巡检投立案（代码级核实）。

**证据**：`gap-ac138-worker-driver-production-enablement` 在 Live 页显示「实现中 started 1h ago」，但 `git worktree list` 该任务零命中、`status=ready`。根因：`.workflow-events/fm-gap-ac138-...-te68sn.jsonl` 只有一条 `eventKind:"start"`（`outcome:null, endedAtMs:null`），从未写结束事件——因为 inner **主动删 worktree 串行等 ac140 先落**（正常操作性暂停，非 complete/crash），而 readLive 消费的事件模型**没有「非正常终结」状态** ⇒ 永久幽灵在飞条目。**本阶段已发生 2 次同类等待**（stable-carrier 等 ac139、ac138 等 ac140-command-configurable），每次都会复现。

## Plan

1. worktree 释放时（无论走哪条路径：完成/崩溃/操作性暂停）写一条 `paused`/`released` 收尾事件。
2. 或 readLive 加基于 worktree 存在性的交叉校验（直接量 vs 事件流不一致 ⇒ 修正）。

## Acceptance Criteria

- [x] AC1：worktree 释放写收尾事件（⛔ 只有 start 无 end ⇒ 假）；或 readLive 交叉校验 worktree 存在性、剔除幽灵在飞。
- [x] AC2：Live 页/Dashboard 不显示已不在飞的任务为「实现中」（⛔ 幽灵在飞 ⇒ 假）。

## Definition of Done

- [x] 收尾事件（或交叉校验）+ 幽灵在飞消除；AC1-2 全勾；land 到 develop。

## Retires

- 无（补事件模型收尾态）

## Touches

- packages/quay/src/observation.ts（readLive 交叉校验/收尾事件消费）
- tasks/gap-live-ghost-inflight-paused-event.md（自身）

> **注意**：写收尾事件的落点若在 inner 侧 fan-in（worktree 释放处），Touches 随实现增补。

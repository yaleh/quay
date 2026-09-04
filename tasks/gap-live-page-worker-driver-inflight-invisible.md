---
id: gap-live-page-worker-driver-inflight-invisible
title: Live 页「在飞任务」表只读 workflow-events，worker-driver 真实在飞全隐形（AC136 缺口的另一半）
status: done
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

**来源**：人问「为什么 Live 页只有 1 个跑了 9h 的任务」，manager 查根因。

**根因**：`readLive()`（Live 页「在飞任务」表的唯一数据源，`packages/quay/src/observation.ts`）**只读 `.workflow-events/*.jsonl`**——inner 旧的 `fast-mode-telemetry --task-start/--task-end` 手动派发记账机制专用载体。**worker-driver 从不写这个文件**（`grep "workflow-events\|task-start\|task-end\|fast-mode-telemetry" worker-driver.ts` 零命中），它有自己独立载体（`worker-round.jsonl` / `worker-outcome.jsonl`）。

**幽灵记录（Live 唯一显示的那条是假的）**：`.workflow-events/fm-gap-direct-to-develop-check-reflog-to-revlist-*.jsonl` 只有 1 条 `start`（04:14:26Z）、无 `end`——该时刻**早于 worker-driver 上线（07:16Z）3 小时**，是 inner 手动派发时期留下、后来被放弃转给 worker-driver 处理的孤儿记录。它没被「幽灵在飞过滤」挡住，是因为那个过滤靠「worktree 是否还存在」判断，而 reflog 的 worktree 确实还在（只是 worker-driver 在用，走另一套完全不重叠的记账）。

**这是 AC136 缺口的另一半**：AC136 已把 promotion-driver 载体接进 Live 页的**池指标**（`observation.ts` PROMOTION_ROUND_REL + readPoolMetrics），但没人做「worker-driver 载体 → 在飞任务表」这一半 ⇒ worker-driver 现在干的全部真实工作 Live 页整个看不见，只剩 9h 幽灵记录充数。

**影响**：web 观测面缺口，不影响生产正确性，但**误导任何看 Live 页判断「driver 在干什么」的人**（真在飞 5 条只显示 1 条幽灵）。

## Plan

1. `readLive()`（或其消费方）合并读取 `worker-round.jsonl` / `worker-outcome.jsonl`，把 worker-driver 真实在飞任务显示出来（同 AC136 模式）。
2. 9h 幽灵记录被正确识别为「记录无 end 且早于 driver 上线、worktree 由别的机制接管」⇒ 不再显示为 in-flight。

## Acceptance Criteria

- [x] AC1：Live 页「在飞任务」表显示 worker-driver 真实在飞（读 worker-round/outcome，⛔ 仍只 workflow-events ⇒ 假）。
- [x] AC2：9h 幽灵记录不再显示为 in-flight（记录无 end 且早于 driver 上线 ⇒ 非 in-flight）。

## Definition of Done

- [x] readLive 合并 worker 载体 + 幽灵记录排除 + Live 页实测显示真实在飞；AC1-2 全勾；land 到 develop。

## Retires

- 无

## Touches

- packages/quay/src/observation.ts（readLive 合并 worker-round/outcome + 幽灵排除）
- packages/quay/test/observation.test.mjs（test）
- tasks/gap-live-page-worker-driver-inflight-invisible.md（自身）

---
id: gap-scheduler-inflight-detection-misses-fan-in-worktree
title: 并发批调度器在飞检测漏 fan-in workflow / 刚派 worktree ⇒ AC53 心跳闸误拒
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

**来源**：inner 上报 + outer 裁定立案（⛔ 非阻塞、低优先级，等当前重叠批落地再派）。

**缺口（实测，非推断）**：`slot-refill` 的 `dispatchable_disjoint` 在重叠场景下把「已 hold 的重叠任务」仍算成可派，`no_refill_reason=null` ⇒ AC53 心跳闸按「有货可派却要睡」误拒写心跳。根因：`concurrent-batch-scheduler` 的**在飞检测不含 fan-in workflow / 刚派 worktree**——它只认某种快照（telemetry 括号或历史在飞集），而 fan-in 中的任务（worktree 存在、subagent 是 workflow 而非独立 Agent）与刚 `git worktree add` 但 subagent 尚未起/已起的任务，都不在其在飞集内。

**证据（2026-08-23 实测）**：ac140 fan-in 在飞（worker-driver.ts）+ ac138 hold（worker-driver.ts 重叠）+ 3 个刚派 web 巡检 worktree 时，`slot-refill` 报 `dispatchable_disjoint=5`、`no_refill_reason=null`，而真实可派=0（全重叠）。心跳写 `--in-flight <4 个 id>` 后闸仍拒（它内部重跑 slot-refill 用自己读到的在飞集，不是我用 flag 传的）。

**同形（硬规则 4b）**：在飞读法用了「快照/代理量」而非「直接量」——`git worktree list` 直接量能枚举 fan-in workflow 与刚派 worktree，快照不能。与本仓 `resource.node_count` 的 comm 正则、outer.ticklog 行形谓词同族。

## Plan

1. `concurrent-batch-scheduler.ts` 的在飞集从快照改为（或补入）`git worktree list` 直接量——fan-in workflow 与刚派 worktree 都算在飞。
2. 取假验证：构造「在飞任务 A touches X + hold 任务 B touches X」⇒ 调度器必须判 B 与 A 重叠、`slot-refill` 的 `no_refill_reason` 非空、AC53 心跳闸不再误拒。

## Acceptance Criteria

- [x] AC1（在飞检测含直接量）：`concurrent-batch-scheduler` 的在飞集含 fan-in workflow / 刚派 worktree（`git worktree list` 直接量，⛔ 仅 telemetry 括号快照）；取假：存在 fan-in worktree 却报 0 在飞 ⇒ 假。
- [x] AC2（闸不误拒）：重叠场景下（在飞 A touches X + hold B touches X）`slot-refill` 的 `no_refill_reason` 非空、AC53 心跳闸接受（⛔ 仍误拒 exit 非 0 ⇒ 假）。

## Definition of Done

- [x] 在飞检测纳入直接量 + 重叠场景闸不误拒；AC1-2 全勾；land 到 develop。

## Retires

- 无（修正在飞读法）

## Touches

- plugin/scripts/concurrent-batch-scheduler.ts（在飞集补 fan-in workflow / 刚派 worktree 直接量）
- plugin/scripts/slot-refill.ts（在飞集补入 touches-disjointness step-4）
- plugin/test/concurrent-batch-scheduler.test.mjs（resolveInFlightWorktrees 单测）
- plugin/test/slot-refill.test.mjs（AC2 重叠场景闸不误拒单测）
- tasks/gap-scheduler-inflight-detection-misses-fan-in-worktree.md（自身）

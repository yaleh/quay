---
id: gap-slot-refill-worktree-proxy-blocks-dispatch
title: "slot-refill.ts 的 occupied_slots 用「worktree 存在」当活性代理——只等落地的 worktree 占槽，load 空闲也派不出 Build"
status: todo
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`slot-refill.ts` 的 `occupied_slots` 把「worktree 存在」当成「占着槽」，同一个 `cap` 数字被同时拿去限制「落地并发」和「实现（Build）并发」——没有任何任务/文档论证过这个复用是刻意的两用设计，是 `occupied_slots` 把 worktree 存在当活性代理算出来的副作用。

**现测代价（此刻正在发生）**：`occupied_slots=6 >= cap=5` 而 `load1=0.30`（近乎空闲）——18 个可派任务里连 1 个都派不出 Build 阶段，纯粹因为 5 个已完成实现、只等落地的 worktree 占着这个数字。

**同根因先例（5b 实例，但「还没轮到修」而非「修漏了」）**：`gap-in-flight-liveness-worktree-proxy-not-process`（todo 未派）已确立正确修法（worktree 存在配进程级 liveness 读法），但其 Touches 只到 `observation.ts` + `fast-mode-telemetry.ts` 两个【展示层读者】，不含 `slot-refill.ts`。同一个根因缺陷（worktree 存在当活性代理）在【后果更大的消费者】（派发闸本身，不只是展示）复现。

## Acceptance Criteria

- [ ] AC1: `occupied_slots`（决定 `should_refill`/`cap` 比较的那个数）只数【真有活进程的】worktree（复用 inner 的 `pgrep bash scripts/test.sh` 一类判活），不把「已完成实现只等落地的 worktree」算进 Build-dispatch 的 cap 比较。
- [ ] AC2: 新增独立、可单独调的 `pending_fanin_backlog`（worktree 总数，不管活性），留作落地积压监控/告警，不参与 Build-dispatch 的 cap 比较。
- [ ] AC3: 不碰 `--reconcile` 的保留判据（worktree 在就该保留记录，这条本身对，同 gap-in-flight-liveness AC3 边界）。
- [ ] AC4: 负控制落在生产载体——load 空闲时 `occupied_slots` 不因「只等落地的 worktree」而 >= cap 派不出（读真实 slot-refill 输出，非 fixture）。
- [ ] AC5: 回退负控制——「无活进程 ⇒ 不计 occupied」不得退化成「读不到 telemetry ⇒ 计 0」；telemetry 可读且有真活进程时 `occupied_slots` 仍 ≥1（守住 `gap-slot-refill-inflight-disconnected-from-worktrees` 已 done 的 AC1 不被新判活逻辑架空）。

## Definition of Done

- [ ] load 空闲时 Build 派发不被「只等落地的 worktree」阻塞，`occupied_slots` 只反映活进程，`pending_fanin_backlog` 独立监控积压（真实输出）。

## Touches

- tasks/gap-slot-refill-worktree-proxy-blocks-dispatch.md（自身）
- plugin/scripts/slot-refill.ts（occupied_slots 进程级判活 + pending_fanin_backlog 独立）
- plugin/test/slot-refill.test.mjs（worktree-present 无活进程 ⇒ 不占 Build cap 负控制）

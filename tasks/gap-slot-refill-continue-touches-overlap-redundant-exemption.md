---
id: gap-slot-refill-continue-touches-overlap-redundant-exemption
title: slot-refill 对 exited-not-landed CONTINUE 任务的 touches-overlap 串行冗余（worktree 已隔离 + 落地已由 fan-in 锁串行）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

slot-refill 的 dispatch gate 对「touches 与在飞任务重叠」的候选一律 defer（`slot-refill.ts:1023` `touches-overlap-in-flight`）。该 defer 防的是「两个 worker 并发改主检出同一文件」，但在两层 worktree 模式下，**exited-not-landed 的 CONTINUE 任务已有自己的 worktree + delta**（worker-driver.ts:1128 复用 worktree，改动隔离），「并发改主检出」这个前提不成立。落地串行由 fan-in workflow 锁（ADR-034，worker-driver.ts:1831 acquire 正确性锁，unbounded 排队）保证——merge develop + ff 本就串行。⇒ 对 CONTINUE 任务，dispatch 级 touches-overlap 是**冗余的过度保守**（两道锁守同一件事），造成「1 次 fan-in 失败 → 永久 touches-overlap 排队」。

**实证 2026-08-29**：7 个 exited-not-landed 任务 1~15h 零续派（fan-in-lock-rename 4.091 strategic-Y 卡 14.6h），盘上 status=ready、ready-pool-check blocking=N，却全被 slot-refill 的 `touches-overlap-in-flight` defer——根因是它们 Touches 含 worker-driver.ts / fan-in 热文件，与在飞任务长期重叠。fan-in-lock-rename 的 Touches 是 8 个热文件（worker-driver.ts + fan-in-ff-merge.sh + fan-in-execute.js×2 + 3 checker + test）。

## Plan

slot-refill dispatch gate 判 touches-overlap 之前，先判候选是否 exited-not-landed（有残留 `task/<id>` worktree 且 worker-outcome final_state=exited-not-landed）；若是，跳过 touches-overlap defer（进推荐），落地仍由 fan-in 锁串行。fresh 任务（无 worktree）保留原 defer。

## Acceptance Criteria

- [x] AC1（能取假）：exited-not-landed 候选（有 worktree）touches 与在飞任务重叠 → 不 defer、进 ready/recommended；（⛔ 仍被 touches-overlap defer ⇒ 假）。
- [x] AC2（能取假，回归）：fresh 候选（无 worktree）同重叠 → 仍 defer（原行为不变）。
- [x] AC3（能取假，落地仍串行）：两个 overlap 的 CONTINUE 任务落地时 fan-in 锁仍串行（merge develop + ff 不并发）——豁免不破坏锁覆盖。
- [x] AC4（能取假，单测）：slot-refill.test.mjs 断言「exited-not-landed 免 overlap defer」+「fresh 仍 defer」，改掉任一 ⇒ 红。

## Definition of Done

slot-refill 对 exited-not-landed CONTINUE 任务免 touches-overlap defer 落地；AC1-AC4 全勾；fan-in 锁串行不受破坏；全量 suite 绿；fan-in-lock-rename 类任务无需人工即续派并 landing。

## Touches

- plugin/scripts/slot-refill.ts（dispatch gate 判 overlap 前加 exited-not-landed 豁免）
- plugin/test/slot-refill.test.mjs（AC4 单测）
- tasks/gap-slot-refill-continue-touches-overlap-redundant-exemption.md（自身）

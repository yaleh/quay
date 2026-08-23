---
id: gap-worker-driver-fake-completion-exit-0
title: worker-driver final_state=completed 假完成（exit_code=0 ≠ 任务落地，3/5 没 merge/翻 done）
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

**来源**：manager 交叉核对 worker-outcome 与真实落地状态（人问「inner 还在跑 fan-in 是不是 worker-driver 没驱动全部执行」时发现）。

**实测（5 条 `completed exit=0` 记录 vs 真实状态，⛔ 非推断）**：
```
完成时刻   driver 自报            实际状态          结论
07:54:29   exit=0 completed  →  status=done   无 worktree  ✅ 真 land
08:19:10   exit=0 completed  →  status=ready  worktree=Y   ❌ 没 land
08:59:42   exit=0 completed  →  status=ready  worktree=Y   ❌ 没 land
09:36:54   exit=0 completed  →  status=ready  worktree=Y   ❌ 没 land
10:29:19   exit=0 completed  →  status=done   无 worktree  ✅ 真 land
```
**5 条里 3 条根本没落地**。

**根因**：`exit_code=0` 只是「进程正常退出」，⛔ 不是「任务完成」。task-worker（claude -p）实现完提交到分支就 exit 0，而 fan-in（ff-merge + 翻 done）是独立一步，worker-driver 不核它是否 land 就记 `final_state=completed`。这是硬规则④推论三的正典形态：**载体有记录 ≠ 事情发生了**。

**影响（比 exit-4 严重）**：exit-4 是 fix-worker 侧、只影响晋升；**这条是 worker 侧、影响「任务到底做完没」**——现在会静默把没做完的任务记成 completed（3/5 假），且 `quay driver status` 的 `carrier_records` 自报 11 / 实际 5（同族「驱动自报值不可信」第二实例）。

## Plan

1. 判据从 `exit_code` 换成「读生产载体确认 land」：`final_state=completed` 必须与 `status=done ∧ 无残留 worktree` 一致。
2. worker-driver 写 `final_state` 前核实际落地状态。

## Acceptance Criteria

- [ ] AC1：`worker-outcome` 的 `final_state=completed` 与该任务实际落地状态一致（`status=done ∧ 无残留 worktree`）；不一致 ⇒ 假。⛔ 判据不写在 `exit_code` 上（那正是失真的量）。
- [ ] AC2：修复落地后 100% `completed` 记录真 land（窗口只计落地后）；出现一条「completed 但 status≠done」⇒ 假。

## Definition of Done

- [ ] 判据改读落地 + worker-driver 写前核落地 + 生产验证 100% 真 land；AC1-2 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/worker-driver.ts（写 final_state 前核 status=done ∧ 无 worktree）
- plugin/test/worker-driver.test.mjs（test）
- tasks/gap-worker-driver-fake-completion-exit-0.md（自身）

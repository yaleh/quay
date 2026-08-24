---
id: gap-worker-driver-cold-start-inflight-blind
title: worker-driver 冷启动 in-flight 盲区（running 纯内存从空起 ⇒ 重复派发 + orphan worktree 误删）
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

**来源**：manager 2026-08-24 事故报告（`promotion-driver-launch.sh restart --kind worker` 并发 2→5 触发，完整记录 `orchestration/manager-tick-log.md` `2026-08-24T01:16:08Z` incident）。

**现象（实测，非推断）**：restart 前有 2 个真实在飞 worker（live-page / AC150，旧 driver spawn）。`cmd_stop` 只 TERM supervisor+driver、不碰 in-flight 子进程 ⇒ 2 个 worker 本身存活。**但新 driver 冷启动的 `running` 是纯内存数组、从空集合开始** ⇒ `ready-pool-check.ts` 仍把这 2 个 task 列进 ready pool（`notInFlight` 完全依赖调用方传入的 `running.map(task)`，无独立的「该 task 已有存活 worktree」过滤维度）⇒ 新 driver 第 1 轮对 live-page 发起**重复派发**（新 pid），与原 worker 撞同一 worktree。kill 重复进程后，其 `failed` 终态触发 `cleanupOrphanWorktree`（worker-driver.ts:337，final_state 只要非 completed/spawn-failed/not-dispatched 就清）⇒ **误删两 worker 共享的 worktree+分支**（原 worker 仍活在使用）。

**机制根因（⛔ 非手工 restart 独有）**：worker-driver.ts 的 supervisor 异常退出后 **5 秒自动 respawn**，走的是同一条冷启动路径——**任何一次 driver 崩溃重启都会复现这个重复派发 + orphan 误删风险**。

**修法（manager 裁定）**：新 driver 冷启动时应**枚举 `git worktree list`（或读一份持久化的 in-flight 登记，而非纯内存数组）交叉核对真实存活的 `quay-task-worker` 进程 pid**，把这些 task 预先纳入「已在飞」排除集。

## Plan

1. worker-driver 冷启动（或每 round 启动）时，枚举 `git worktree list` 的 task worktree + 交叉核对对应存活 worker 进程（/proc pid + cmdline `quay-task-worker`），构建「已在飞」排除集。
2. `notInFlight` 排除这些 task（⛔ 不能只依赖内存 `running` 数组）。
3. `cleanupOrphanWorktree` 增加存活校验：worktree 有存活 worker 正在用 ⇒ 不清（⛔ 只清真 orphan）。

## Acceptance Criteria

- [x] AC1（能取假）：冷启动后（模拟 restart 前有存活 worker + 其 worktree），driver 不再重复派发这些 task（⛔ 仍重复派发 ⇒ 假）。— test `AC1 (cold-start) — surviving worker + its worktree ⇒ resident loop does NOT re-dispatch that task` + 对照 `orphan worktree ⇒ IS re-dispatched`
- [x] AC2（能取假）：`cleanupOrphanWorktree` 不清「有存活 worker 正在用」的 worktree（⛔ 误删共享 worktree ⇒ 假）。— test `AC2 (cold-start) — cleanupOrphanWorktree skips a worktree a live worker is using`

## Definition of Done

- [x] 冷启动 in-flight 排除集落地（worktree 枚举 + pid 核对）+ cleanupOrphanWorktree 存活校验；AC1-2 全勾；land 到 develop。

## Retires

- 无（running 纯内存数组作为 in-flight 唯一真相源的用法）

## Touches

- plugin/scripts/worker-driver.ts（冷启动 in-flight 排除集 + cleanupOrphanWorktree 存活校验）
- plugin/test/worker-driver.test.mjs（test：restart 后存活 worker 不重派 + orphan 存活校验不清）
- tasks/gap-worker-driver-cold-start-inflight-blind.md（自身）

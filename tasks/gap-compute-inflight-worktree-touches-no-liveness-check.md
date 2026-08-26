---
id: gap-compute-inflight-worktree-touches-no-liveness-check
title: computeInFlightWorktreeTouches 无活进程检查——死 worktree 占用 Touches 锁死全部派发（pool=31 候选全被挡，单死 worktree 锁 23 候选）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **止损：需要 —— 已由 manager 执行**：`worker-driver --task gap-ac155-config-merge-control-state-split-event-polling` 显式派发路径绕过 slot-refill 推荐，解堵成功（ac155 已派活）。修复走本任务路径。

## Proposal

`plugin/scripts/concurrent-batch-scheduler.ts:356` `computeInFlightWorktreeTouches()` 把**任何存在的 task worktree** 当作「在飞」，占用其 `## Touches` 声明的所有文件，**全程零活进程检查**（读码核实 `resolveInFlightWorktrees` 完整函数：只做「非主检出 + branch 解析 task id + 任务文件存在 + 有 Touches 段」四步，无一行活进程检查、无任何超时）。

**实测（直接量，逐 worktree 数 `/proc/*/cwd`，manager 08:5xZ）**：
```
9 个 worktree，只有 1 个有活进程（gap-ac144 刚派发）
其余 8 个零活进程，最老 gap-direct-to-develop-check-reflog-to-revlist 最后提交 08-23（60h+ 前）
⇒ slot-refill recommended=[]，pool=31 候选【全部】被挡，slots_free=4 却派不出去
⇒ 单个死 worktree gap-ac155 一个就锁住 23 个候选（其 Touches 覆盖 13 个产品文件）
⇒ 连续 3 轮同稳态（非瞬时抖动）
```

**⛔ 不能删这些 worktree**——它们携带真实未合并工作（gap-ac155 13 产品文件 drivers.yml 声明式配置整套改造 / serial-lowconc 8 测试文件 / lpt-lookback 3 / load-sampler-orphan 2 / concurrent-session 2 / worker-driver-periodic-exit 1）。

**⊢ 与仓库自己的纪律冲突**：CLAUDE.md 已明写「**worktree 存在 ≠ 有人在干活**……判层活性的正本是直接量（git log 提交时刻 / worktree 内活进程）」——本机制恰恰违反仓库已写下的那条纪律（硬规则 4b 代理量偏离实际）。

**⊢ 与 `gap-ff-starvation-no-dynamic-cap-relief` 不重叠**：那条管「能派但撞 ff」，本条管「根本派不出去」；两者叠加会让吞吐归零。

## Plan

1. `computeInFlightWorktreeTouches` 的「在飞」判定加**直接量活性检查**：worktree 下**零活进程** 且 **超过 N 分钟无新提交** ⇒ 不计入在飞（不占用其 Touches）。活性直接量 = worktree 内活进程（`/proc/<pid>/cwd`）+ `git log` 该分支末次提交时刻（复用 CLAUDE.md 已写的直接量，不新造派生量）。
2. N 的取值落笔方定（候选：一轮 suite 时长 ~15min，或对齐既有 stale 阈值），⛔ 不得用「worktree 存在」当活性。

## Acceptance Criteria

- [ ] AC1（能取假，死 worktree 不计入在飞）：`computeInFlightWorktreeTouches` 对「零活进程 + 超 N 分钟无新提交」的 worktree 不计入在飞（不占用其 Touches）；（⛔ 死 worktree 仍计入 ⇒ 假）。
- [ ] AC2（能取假，负控制解堵）：造一个死 worktree（有 Touches + 零活进程 + 无新提交），`slot-refill` 不再因其 Touches 而 defer 候选（候选不再被死 worktree 挡，recommended 非空）；（⛔ 仍被挡 / recommended 空 ⇒ 假）。
- [ ] AC3（能取假，不误伤活 worktree）：有活进程的 worktree 仍计入在飞（不被误判为死、不被排除）；（⛔ 活 worktree 被误排除 ⇒ 假）。

## Definition of Done

`computeInFlightWorktreeTouches` 加直接量活性检查；AC1-AC3 全勾；死 worktree 不再锁死派发、活 worktree 不被误伤。

## Touches

- plugin/scripts/concurrent-batch-scheduler.ts（computeInFlightWorktreeTouches 加活进程 + 末次提交时刻活性检查）
- plugin/test/concurrent-batch-scheduler.test.mjs（死 worktree 不计入 + 活 worktree 不误伤负控制）
- tasks/gap-compute-inflight-worktree-touches-no-liveness-check.md（自身）

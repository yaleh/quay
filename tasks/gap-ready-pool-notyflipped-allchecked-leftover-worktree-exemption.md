---
id: gap-ready-pool-notyflipped-allchecked-leftover-worktree-exemption
title: ready-pool notYetFlipped allChecked 臂排除「fan-in 失败未落地」任务 → 永久搁浅 + 冻住整池
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`ready-pool-check.ts` 的 `notYetFlipped()` 末行是 `return doneFlipReady || allChecked`：`allChecked`（AC+DoD 全部勾选）是独立臂，**不需要任何落地证据**就判 not-yet-flipped → 任务被排除出派发池，driver 对它 `defer` 不派（`worker-driver.ts:1038`）。

**实证 2026-08-29（gap-scd-load-sensitive-bucket-isolation）**：worker 在实现轮勾满 AC → 退出 → driver 机械 fan-in 失败（suite red / merge-develop 冲突）→ 任务留在「ready + 全勾 + 未落地」。下一轮被 `allChecked` 排除 → 落地路径（worker 派发 → driver fan-in）永远不跑 → **永久搁浅，必须人工 uncheck AC 才解开**。附带效应：该任务还污染整池——`pool_big_all_colliding: True`、`dispatchable_disjoint: 0`、`criterion_met: False`，uncheck 后全部恢复（`dispatchable_disjoint` 0→8），单个死任务能冻住全部派发。

`allChecked` 臂是 2026-08-08 加的（`ready-pool-check.test.mjs:685` `acCompleteNotLanded → notYetFlipped true` 钉死）：当时 17/21 的 ready 任务是「AC 全勾但无落地证据」的 prose-AC 风格，`taskWorkLanded` 抓不到 → 无限重派。该臂防的是「浪费重派」，代价是「永久搁浅」——后者更贵（不可自愈，需人盯）。

## Plan

**方案 B（外科手术式最小改动）**：给 `allChecked` 臂加「残留 worktree」豁免。fan-in 失败（exited-not-landed）会保留 `task/<id>` worktree（ff-merge 成功才删），故 worktree 存在 = fan-in 未完成 = 任务必须保持可派发。

```js
// ready-pool-check.ts notYetFlipped() 内
const hasLeftoverWorktree = worktreeExists(task.id); // git worktree list 含 task/<id>
return doneFlipReady || (allChecked && !hasLeftoverWorktree);
```

语义：
- 全勾 + **有**残留 worktree（fan-in 失败/进行中）→ 可派发 → 下一轮 worker 派发触发 driver 机械 fan-in 重跑 → 自愈；
- 全勾 + **无**残留 worktree（真落地 / 2026-08-08 prose-AC 情形）→ 排除（只差 flip）——保留原行为；
- 不动 `taskWorkLanded` / `（待外部）` 注解机制。

## Acceptance Criteria

- [x] AC1（能取假）：ready 任务 AC 全勾 **且**存在 `task/<id>` 残留 worktree → **不在** `excluded`、在 `ready`（保持可派发）。 **Evidence:** `ready-pool-check.test.mjs` 新增 `LEFTOVER-WORKTREE` 单测：allChecked + 造 `task/<id>` 残留 worktree → `notYetFlipped` 返回 false、`analyzeTasks` 把它放进 `ready` 不在 `excluded`；直接跑 128/128 pass。
- [x] AC2（能取假，回归）：ready 任务 AC 全勾 **且无**残留 worktree → 仍判 not-yet-flipped、在 `excluded`（2026-08-08 行为不变）。 **Evidence:** 同一单测负控制：无 worktree → `notYetFlipped` true 仍 excluded；`git worktree remove` 后恢复 exclusion；既有 `acCompleteNotLanded`（无 worktree → excluded）保持绿，128/128 pass。
- [x] AC3（能取假，SCD 形状回归单测）：`ready-pool-check.test.mjs` 新增「全勾 + 造残留 worktree → 进 `ready` 列表」用例；既有 `acCompleteNotLanded`（无 worktree → excluded）保持绿。 **Evidence:** 新增 `analyzeTasks keeps an allChecked + leftover-worktree task in ready, not excluded` 用例；既有 `acCompleteNotLanded` 仍在 128 通过集内不回归。
- [x] AC4（能取假，池级效应）：单个 not-yet-flipped 死任务不再使 `dispatchable_disjoint` 归零 / `pool_big_all_colliding` 变 True。 **Evidence:** 新增 `a single allChecked dead task no longer zeroes the pool` 单测：`pool=1`、`dispatchable_disjoint=1`、`pool_big_all_colliding=false`。
- [x] AC5（能取假，消费者一致）：`slot-refill` 的 `excludedNyfIds` 消费随之正确——有 worktree 的 allChecked 任务进入推荐/可派发。 **Evidence:** `slot-refill.test.mjs` 新增 `NOT-YET-FLIPPED — a leftover task/<id> worktree exempts the allChecked arm` 单测：`excludedNyfIds` 不含该任务、`isNotYetFlippedSkip` false + remove worktree 负控制恢复 excluded；107/107 pass。

## Definition of Done

`notYetFlipped` 的 `allChecked` 臂加残留-worktree 豁免并落地；`ready-pool-check.test.mjs` / `slot-refill.test.mjs` 新增用例绿、既有用例不回归；全量 suite 绿；fan-in 成功落地。gap-scd-load-sensitive-bucket-isolation 类「全勾未落地」任务此后无需人工干预即可被重派并 landing。

## Touches

- plugin/scripts/ready-pool-check.ts（notYetFlipped allChecked 臂加 worktree 豁免 + worktreeExists 信号）
- plugin/scripts/task-status-drift-check.ts（若 worktreeExists 落点在此）
- plugin/test/ready-pool-check.test.mjs（AC1/AC2/AC3 用例）
- plugin/test/slot-refill.test.mjs（AC5，excludedNyfIds 消费行为）
- tasks/gap-ready-pool-notyflipped-allchecked-leftover-worktree-exemption.md（自身）
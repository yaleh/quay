---
id: gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact
title: goal-driver 每轮算出的 GoalGap（含 done-unresolved）从不落痕，只用于内部 spawn 过滤
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/goal-driver.ts:2987` 每轮都调用 `computeGoalGaps(...)`，算出每条 active AC 的五态之一
（`gap` / `done-unresolved` / `stalled` / `in-progress` / `not-evaluated`，另有 standing/frozen population
的对应态）。**这个结果只喂给 `runGapSpawnPass`（决定要不要 spawn 立案 agent），从未写进
`.quay/goal-round.jsonl` 的任何一条 fact——算完就扔。**

<!-- dedup-ref -->
`isFilingGapState`（`goal-driver.ts:2306`）明确只对 `gap`/`standing-violated`/`frozen-violated`
三态 spawn，`done-unresolved` 被有意排除，注释写得很清楚："done-unresolved/standing-ok 无工作要立"——
**这是一个经过深思的防噪音设计，不是缺陷，本任务不改动它**（对 done-unresolved 状态的 AC 不该每轮无
意义地 spawn 一次 LLM agent，那正是这条判断存在的目的）。

真正的缺口是**可见性**：一条 AC 卡在 `done-unresolved`（已有 done/superseded 任务认领、判据依然为假、
且没有任何机制会再碰它）时，driver 自己是知道的（每轮都算出来了），但这个事实除了活在当轮进程内存里，
哪里都看不到。2026-09-16 这一整晚（GOAL-020 AC-265/AC-274、GOAL-019 AC-261）就是这个可见性缺口的实测
代价：人只能靠反复手写外部脚本重新推导同一个计算（读 `goal-round.jsonl` 拿 active+fail 的 AC 列表，
再逐条 grep `tasks/*.md` 找 `goal_ac` 认领任务、查它们的 status）——这套推导逻辑和 `computeGoalGaps`
内部做的事**逐字重复**，只是活在 driver 进程外面、每次都要重新写一遍。

修法：把 `gaps`（或至少 `done-unresolved`/`stalled` 这两个"有信号但没人管"的子集）作为一条新 fact
（例如 `goal-gaps`）写进本轮 record，`state`/`taskCount`/`goal`/`ac` 逐条落痕——**不改变任何 spawn
行为，纯观测性新增**。这样任何后续消费者（人工检查、未来的告警机制、meta-cc 查询）都能直接读这条 fact，
不需要重新推导。

## AC

- [ ] `goal-round.jsonl` 每一轮的 record 里新增一条 `name: "goal-gaps"` 的 fact，`value` 至少含每条非
      `in-progress`/`standing-ok` 态 AC 的 `{goal, ac, state, taskCount}`（`gap`/`done-unresolved`/
      `stalled`/`not-evaluated`/`standing-violated`/`frozen-violated`/`derived-routed` 均需出现，覆盖
      `computeGoalGaps` 返回的全部非平凡态，不只挑 done-unresolved 一种）。
- [ ] 负控制：本任务落地前后各跑一轮 `goal-driver.ts` 的单元测试（`plugin/test/goal-driver.test.mjs`），
      confirm 新增的 fact 不改变 `runGapSpawnPass` 的 spawn 决策（同一份 `gaps` 输入，spawn 结果字节级
      相同）——证明这是纯观测性新增，不是行为变更。
- [ ] 用一条真实历史轮次（或新跑一轮）验证：AC-261/AC-265/AC-274 这类曾经卡在 done-unresolved 的 AC，
      在对应轮次的 `goal-gaps` fact 里能被找到，且 `state` 字段就是 `"done-unresolved"`。

## DoD

不需要再手写外部脚本重新推导"哪条 AC 卡在 done-unresolved 没人管"——`tail -1 .quay/goal-round.jsonl`
本身的 `goal-gaps` fact 就能直接回答，`jq` 一条命令可查，不用再对着 `tasks/*.md` 跑一遍 grep 循环。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact.md

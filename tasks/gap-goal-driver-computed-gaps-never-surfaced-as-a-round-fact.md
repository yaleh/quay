---
id: gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact
title: goal-driver 每轮算出的 GoalGap（含 done-unresolved）从不落痕，只用于内部 spawn 过滤
status: ready
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

- [x] `goal-round.jsonl` 每一轮的 record 里新增一条 `name: "goal-gaps"` 的 fact，`value` 至少含每条非
      `in-progress`/`standing-ok` 态 AC 的 `{goal, ac, state, taskCount}`（`gap`/`done-unresolved`/
      `stalled`/`not-evaluated`/`standing-violated`/`frozen-violated`/`derived-routed` 均需出现，覆盖
      `computeGoalGaps` 返回的全部非平凡态，不只挑 done-unresolved 一种）。
- [x] 负控制：本任务落地前后各跑一轮 `goal-driver.ts` 的单元测试（`plugin/test/goal-driver.test.mjs`），
      confirm 新增的 fact 不改变 `runGapSpawnPass` 的 spawn 决策（同一份 `gaps` 输入，spawn 结果字节级
      相同）——证明这是纯观测性新增，不是行为变更。
- [x] 用一条真实历史轮次（或新跑一轮）验证：AC-261/AC-265/AC-274 这类曾经卡在 done-unresolved 的 AC，
      在对应轮次的 `goal-gaps` fact 里能被找到，且 `state` 字段就是 `"done-unresolved"`。

## DoD

不需要再手写外部脚本重新推导"哪条 AC 卡在 done-unresolved 没人管"——`tail -1 .quay/goal-round.jsonl`
本身的 `goal-gaps` fact 就能直接回答，`jq` 一条命令可查，不用再对着 `tasks/*.md` 跑一遍 grep 循环。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact.md
- docs/analysis/quay-init-closure-ratchet.baseline.json（执行期解阻：见 §执行期记录）

## 执行期记录（执行者，2026-09-16）

**1. 立案前提经复算后被证伪（如实记录，⛔ 不改写上面的 Proposal——那是立案时的事实）。**
Proposal 写「`gaps`…从未写进 `.quay/goal-round.jsonl` 的任何一条 fact——算完就扔」，**不成立**：
实测自 `3e909bdd0`（G7 gap calc）起，该数组一直写在 **`goal-ring` fact 的 `value.gaps`** 里；
最新一轮（round 43/44, 2026-09-16T08:49Z / 09:02Z）含 23 条读数、其中 1 条 `done-unresolved`（AC-274）。
AC-261 / AC-265 / AC-274 在真实历史轮次里以 `state="done-unresolved"` 出现过 **144 / 99 / 81** 次
（首条 2026-09-15T05:13Z / 14:52Z / 18:57Z）——**一条 jq 命令当时就能查到**：
`jq -c '.facts[]|select(.name=="goal-ring")|.value.gaps[]|select(.state=="done-unresolved")' .quay/goal-round.jsonl`
⇒ 真正的缺口是**可见性/命名**（人得知道去 `goal-ring` 的内部结构里翻），**不是数据缺席**。
本实现据此仍按 AC-1 落一条**独立的 `goal-gaps` fact**（顶层可按 name select，`value.gaps` 是同一条
`computeGoalGaps` 返回数组的过滤投影——⛔ 不是第二处计算，同轮同源不可能漂移）。

**2. 执行期追加的解阻（越出原 Touches，如实记录，非原计划）。**
scoped 门首跑红在 `quay-init-closure-ratchet-stale`，**与本任务 delta 无关的既存全仓红**：
`--check-stale` 报 `changed: plugin/.claude-plugin/plugin.json`，而
`git diff develop -- plugin/.claude-plugin/plugin.json` 为空（该文件是 develop 侧的）。
根因 = **发版 bump 漏重锚**：`eb17c4ac1`（2026-09-16 08:43Z，「release: strip -dev suffix for the
v0.7.1 release cut」）改了四个 fingerprint source 之一 `plugin.json`，而上一次重锚
`7b3b0ccb9`（2026-09-15 14:58Z）在它之前。**识别特征与记忆中的第二次实证逐字相同**（0.6.2→0.6.3）。
**已实测零增长**（`--gate`：`3 files / 1022 bytes ≤ baseline 3/1022`，-dev 后缀同长度 ⇒ 只动 sha 轴、
不动字节轴）⇒ `--reanchor` 是**纯新鲜度刷新、不掩盖任何增长**（`files`/`bytes` 逐字不变，
`git diff` 只剩 `fingerprint` 与 `plugin.json` 的 `sha`）。按既存先例（`gap-ac169-…:55`、
`gap-dist-plugin-missing-node-modules-task-schema-yaml:73`）把
`docs/analysis/quay-init-closure-ratchet.baseline.json` 登记进本任务 Touches。
⚠️ 这是**全局阻塞**（该静态检查 fail-closed，任何任务的 scoped 门都在此处中止）——发版流程的正解仍是
bump 与 `--reanchor` 同提交或紧邻提交。

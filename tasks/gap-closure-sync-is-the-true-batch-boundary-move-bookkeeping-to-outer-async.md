---
id: gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async
title: bookkeeping is the real batch boundary — the inner currently closes
  batches itself (Close batch-2/3/4 in its dispatch history) and dispatch stalls
  during closure; move 收尾/记账 fully async to the outer so the inner only
  executes+dispatches+merges and never pauses for (or even knows about) closure
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人的设计裁定（2026-08-05，**决定不是建议**）：收尾/记账异步做没问题，但**不要把这个逻辑和行为暴露
给 inner**。

**现状实测（人给证据）**：收尾是 inner 在派的——「Close batch-2/3/4 task bodies」三次都在 inner 的
Agent 派发历史里（21:56:29 / 23:33:28 / 01:59:27），且每次收尾之后必定跟一个 3 连发（22:44 / 00:24 /
02:08，间隔 4-8 秒），**收尾期间零新派发** ⇒ 记账变成了调度的同步点。**这就是批次边界的真正来源**——
比「batch 措辞」问题深一层，改名解决不了。

**技术安全（人已核实）**：`ready-pool-check` 的 `notYetFlipped` 用 `taskWorkLanded(task.body, repoRoot)`
独立判断工作是否落地（`ready-pool-check.ts:128-130`），**不依赖 `status: done` 字段** ⇒ 收尾完全异步
化到外层后，inner 的就绪池计算仍然正确，没有隐藏依赖。

**目标形态**：inner 只管**执行 + 派发 + 合并**，永远不因记账停顿，**也不知道收尾这件事存在**；收尾由
外层按自己的节奏**异步**做（外层本来就有 20 分钟 cron）。

### 选定机制

1. **inner 循环删收尾步**：`fast-mode-loop-tick.md` 去掉「fan-in 关闭任务时」的记账动作——不翻
   done、不写关闭记录、不跑收尾 gate。inner 循环只剩：派发（含 `--task-start` 遥测）→ 执行 →
   合并（fan-in）。**收尾这词从 inner 侧彻底消失。**
2. **外层 tick 加异步收尾例程**：`orchestrator-loop-tick.md` 每次 tick 做收尾 pass——用
   `taskWorkLanded`（非 status）探测「工作已落地但未翻 done」的任务，逐个：关遥测括号
   （`--task-end`）→ 翻 done → 写关闭记录（`verification-round-N`）→ 该 round 的全量 suite 作为
   收尾 gate。收尾是外层 20-min-cron 的活，不与 inner 派发争任何同步点。
3. **inner 的「上一步全量 suite 非绿」停止条件改读外层记录**：inner 不再自己跑收尾 gate，改为读外层
   最近一次 `verification-round-N` 结果文件；绿色才能继续派发，但**不等收尾发生**。
4. **与 batch 措辞任务分层**：`gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round` 是
   措辞层（改名防误读）；本条是**机制根**（收尾不再同步）。两者分层：词汇任务照做，本条落地后词汇
   任务的范围自然收窄（inner 侧不再有「批」概念，只剩外层 verification-round）。

## Acceptance Criteria

- [ ] AC1: `fast-mode-loop-tick.md` inner 循环删除收尾/记账步——无「Close batch-N」、无任务体翻 done、
      无关闭记录；循环 = 派发（含 `--task-start`）+ 执行 + 合并（fan-in）
- [ ] AC2: `orchestrator-loop-tick.md` 外层 tick 加**异步收尾例程**——每 tick 用 `taskWorkLanded`
      （非 status）探测落地未翻任务，逐个关遥测括号 + 翻 done + 写 `verification-round-N` 记录；
      全量 suite 为外层收尾 gate（非 inner 同步点）
- [ ] AC3: inner 的「上一步全量 suite 非绿」停止条件**改读外层 verification-round 结果文件**（非自己跑）；
      读不到时按文档定义处理（fail 或等下一 tick），但不产生 inner 侧记账
- [ ] AC4: **grep 证明**——inner 侧（`fast-mode-loop-tick.md` + inner 派发路径的脚本）零「收尾/Close
      batch/记账/close」指令，且零 `status: done` 依赖（实跑输出贴任务体）
- [ ] AC5: **真实使用**——本变更后至少一次 verification-round 收尾由**外层**执行（非 inner），且该窗口
      内 inner 的派发历史显示**持续派发、未因记账停顿**（证据 = inner Agent 派发时间戳 + 外层收尾
      记录时间戳对比）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`（若收尾探测逻辑成脚本）
- [ ] AC7: `gap-split-batch-vocabulary-...` 任务体更新——注明本任务是「批次边界」的机制根，词汇任务是
      措辞层（改名解决不了同步点）

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC4/AC5 实跑输出逐字贴任务体
- [ ] inner 侧不再有任何收尾行为（grep + 一次真实 cycle 证明）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/fast-mode-loop-tick.md（inner 循环删收尾步）
- plugin/loop/orchestrator-loop-tick.md（外层加异步收尾例程）
- tasks/gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round.md（AC7 交叉标注）
- （外层收尾探测若成脚本，落 plugin/scripts/ 下，复用 taskWorkLanded 现有实现）

## Contract

measure   last_closure_actor = 最近一次 verification-round 收尾的执行者（git 记录 + Agent 派发历史）
band      last_closure_actor = outer（收尾只能由外层做；inner 不得出现 Close-batch 派发）
invariant inner_dispatch_no_stall = 1（演示窗口内 inner 持续派发、零因记账停顿）
invoke    `grep -rn 'Close batch\|收尾\|记账' plugin/loop/fast-mode-loop-tick.md plugin/scripts/`
control   构造落地未翻任务（合并已落、status 仍 ready）⇒ 外层收尾必须翻 done；inner 不得翻
          （grep 证明 inner 无收尾路径）
resume    内层循环删步与外层收尾例程分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T02:1xZ
changed: 外层受人设计裁定立案。四处收紧：
(1) **批次边界真源是记账同步**——不是措辞；「Close batch-2/3/4」三次在 inner 派发史 + 每次收尾后必
    跟 3 连发 + 收尾期零派发 = 记账成调度同步点，改名解决不了；
(2) **目标形态写死**——inner 只执行+派发+合并、不知道收尾存在；收尾是外层 20-min-cron 的异步活；
(3) **技术安全已核**——ready-pool-check notYetFlipped 走 taskWorkLanded 不依赖 status:done
    （ready-pool-check.ts:128-130），收尾异步化无隐藏依赖；
(4) **AC5 真实使用**——必须证一次外层收尾窗口内 inner 持续派发，不空转。
status: ready——人裁定机制根，优先于就绪队列一般项；与 batch 措辞任务分层（机制根 vs 措辞层）。

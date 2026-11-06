---
id: gap-goal-next-unchanged-rounds-escalation
title: goal next 行带 unchangedRounds：连续 ≥8 轮未变的 wait 行升级为人动作
status: ready
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-943
---
## Proposal

`GoalNextRow`（`packages/quay/src/core/goal-analysis.ts:268`）只有 `{goal, ac, gapState, rank, owner, action, evidenceRefs, blocker}` —— 没有任何一维表达「持续多久」。`world-gated` 的映射是固定的 `owner:"world" / action.kind:"wait"`（同文件 `STATE_PLAN`），而 `readGoalNextCarrier` 只读**最近一轮** fact ⇒ 第 1 轮与第 53 轮的行逐字相同，「刚在等」与「卡住了」在投影面上不可区分。

生产实测（2026-11-06，`.quay/goal-round.jsonl`）：`goal-next` fact 的 `GOAL-914/AC-936` 行在 19:53–20:44Z 连续 6 轮为 `world-gated/world/wait`，逐字相同；同一份轮载体里 `goal:AC-936:verdict` 的 unchanged streak 已 count=53、crossed=true（threshold 8），但这条持久度只喂给 meta 读数，`goal-next` 不消费它。

持久度的**产生机制**其实已存在，缺的是接线：`plugin/scripts/meta-driver.ts` 的 `deriveGoalCarrierSignals` 从同一份轮载体派生每条 AC 的 `unchanged` streak。本任务把它接到投影上，并加一条升级规则：连续 ≥8 轮未变的 wait 行不再以「等世界」呈现，而是变成需要人动作的取值。

四条设计约束，每条对应一种会**静默出错**的写法：

1. ⛔ **不能拿「呈现后的行」算 streak**。升级本身会改 `rank`/`owner`/`action.kind`；若用它算 streak，第 8 轮升级、第 9 轮 streak 归 1、第 10 轮再升 —— 8 轮一次的振荡，而每一轮的单轮读数都「看着对」。⇒ 每行持久一个**升级前**的稳定 `streakKey`（`<ac>|<gapState>|<baseRank>|<baseOwner>|<baseKind>`），streak 只比它，升级只改呈现字段。
2. 硬规则 3b：读不到历史 ⇒ `unchangedRounds: 0` **且** `unchangedRoundsEvaluated: false`。「0 轮」与「没读到」不同形 —— 否则「历史读失败」会伪装成「一切正常且没卡住」。
3. 硬规则 4c：这个量要穿过四段（载体 tail 读 → streak 计算 → fact 写入 → CLI 读出）；任何一段抹掉字段，AC 都要当场红。生产载体 2026-11-07 实测 **368MB** ⇒ ⛔ 全量解析，只读有界 tail。
4. `gapState` 永远保持诚实 reading（`world-gated` 仍显示 `world-gated`），升级只体现在 `rank`/`owner`/`action` + 新增字段 —— 同 `gap-goal-driver-blocked-taxonomy` 已立的纪律（escalation 可见于 rank/owner/action，⛔ 不重写 reading）。

升级对**三种** wait 态一律生效（`world-gated` / `derived-routed` / `standing-ok`）：判据是「`action.kind === "wait"` ∧ ≥8 轮」，不按 gapState 挑。理由文本必须写出**是哪种等**（等世界 / 等别家 AC / 常设不变量一直成立），让读的人自己能判「这是卡住还是本来就该安静」；⛔ 不要给 `standing-ok` 开豁免——AC-943 的判据不会豁免它，开了就红。

<!-- dedup-ref -->
与本任务相邻但不同机制、均已完成：`gap-goal-next-projection`（AC-935）建的是投影本身与其读面，`gap-goal-driver-blocked-taxonomy` 建的是 `blocked-*` 的成因落痕；本次只追加「持久度这一维」。另一个开着的任务 `gap-meta-call-ac-936-needs-a-human-run-goal-request-in` 与本次共用 `plugin/scripts/goal-driver.ts` 但机制无关（它是人工请求裁定），保持独立立案。

## Plan

1. **Core 纯函数**（`packages/quay/src/core/goal-analysis.ts`）
   - `GoalNextRow` 增四个字段：`streakKey: string`（升级前的决策签名）、`unchangedRounds: number`、`unchangedRoundsEvaluated: boolean`、`escalated: boolean`。
   - 新增 `export const GOAL_NEXT_UNCHANGED_ESCALATE_THRESHOLD = 8`（与 meta-driver 的 `VERDICT_UNCHANGED_THRESHOLD` 同值同安全网语义；⛔ Core 不能 import plugin 侧常量 —— 那是反向边，`import-graph-check` 第四/第六规则）。
   - `goalNextProjection(records, gaps, taskFacts, history?)` 第 4 参 `history: GoalNextHistoryRound[] | null`（oldest→newest；`null` = 载体读不出）。缺省 `[]` ⇒ 每行 `unchangedRounds:1, unchangedRoundsEvaluated:true`（本轮即 streak 首轮）。
   - 新增纯函数 `unchangedRoundsOf(row, history)`：从最新一轮往回数，`streakKey`（历史行没有该字段时按 `ac+gapState+rank+owner+action.kind` 现算，兼容旧轮行）不等即停；`evaluated:false` 的轮**打断**（仪器失败 ≠ 未变）；fact 缺失的轮由调用方过滤掉，不打断也不计数。
   - 升级：`unchangedRoundsEvaluated && unchangedRounds >= 8 && action.kind === "wait"` ⇒ `rank: "stuck-wait"`（`GOAL_NEXT_PRIORITY` 新增该值，置于 `needs-human` 之后、`blocked-needs-human` 之前）、`owner: "human"`、`action.kind: "ask-human"`、reason 带 N 与 wait 的成因；`gapState`/`streakKey`/`evidenceRefs`/`blocker` 不变。
2. **轮载体读取单一实现**（新建 `packages/quay/src/core/goal-round-carrier.ts`）：把 `cli/goal.ts` 里的 `readRoundLogTail` 上收为共享实现（有界 tail、丢半行；CLI 与 driver 共用，⛔ 不要各写一份 —— 硬规则 5b），并新增 `readGoalNextHistory(file, { maxRounds, maxBytes })` 返回 `GoalNextHistoryRound[] | null`（文件不存在/读失败 ⇒ `null`，⛔ 不是 `[]`）。
3. **driver 接线**（`plugin/scripts/goal-driver.ts`）：`GoalRoundOptions` 增测试缝 `goalRoundCarrierPath?: string`；每轮在 ⑤b 调投影前读 history（读失败传 `null`，⛔ 不静默传 `[]`）；`goalNextFact` 的 reason 带上被升级的行数。`plugin/scripts/driver-runtime.ts` 增补新导出符号（driver ⛔ 不写 Core 源码树字面量）。
4. **CLI**（`packages/quay/src/cli/goal.ts`）：`goalNextRowProblem` 增校验（`unchangedRounds` 是有限非负数、`unchangedRoundsEvaluated` 是布尔、`streakKey` 非空），缺字段的旧格式轮行 ⇒ NOT-EVALUATED（exit 3），⛔ 不补 0 冒充已读；文本模式的行尾追加轮数与升级标记。`packages/quay/src/cli/help.ts` 的 `goal next` 段落补字段说明。
5. **测试**：纯函数边界（0/1/7/8/9 轮、reset、`evaluated:false` 打断、`history=null`）；载体读取（半行、`maxRounds`、文件缺失 ⇒ null）；driver 链路（fixture 载体跑一轮 `runGoalRound`，断言 fact 行三字段齐且 8 轮等待行已升级）；CLI 读面（`--round-log` fixture，旧格式 ⇒ exit 3、合规 ⇒ exit 0 且数字字段）。
6. **生产读数**：落地后由主检出跑一轮 goal-driver，`quay goal next --root . --json` 每行带数字 `unchangedRounds`（即 AC-943 判据本身）。

## Touches

- packages/quay/src/core/goal-analysis.ts
- packages/quay/src/core/goal-round-carrier.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- plugin/scripts/goal-driver.ts
- plugin/scripts/driver-runtime.ts
- packages/quay/test/goal-analysis.test.mjs
- packages/quay/test/goal-round-carrier.test.mjs
- packages/quay/test/cli-goal-read-surface.test.mjs
- plugin/test/goal-driver.test.mjs
- plugin/test/goal-driver-s01.test.mjs
- tasks/gap-goal-next-unchanged-rounds-escalation.md

## AC

- [ ] `node --test packages/quay/test/goal-analysis.test.mjs` 退出码 0（既有行形状断言已随四字段更新）。
- [ ] 纯函数边界：`history=[]` ⇒ 每行 `{unchangedRounds:1, unchangedRoundsEvaluated:true}`；7 轮相同 + 本轮 ⇒ `8` 且仍 `owner:"world"/kind:"wait"`；8 轮相同 + 本轮 ⇒ `9` 且 `owner:"human"`、`action.kind==="ask-human"`、`rank==="stuck-wait"`、`gapState` 仍 `world-gated`、`streakKey` 与未升级时逐字相同。
- [ ] 负控制 1（升级不改 streak 输入）：把一条已升级行当作下一轮 history，下一轮该行 `unchangedRounds` 必须继续递增（≥10 的下一个值），⛔ 不回落成 1；把 history 里某一轮的 `streakKey` 改一个字 ⇒ 归 1。
- [ ] 负控制 2（读不到 ≠ 未变）：`history===null` ⇒ 每行 `unchangedRounds===0 && unchangedRoundsEvaluated===false` 且无一行 `escalated===true`。
- [ ] 载体读取：fixture 轮载体含 8 条相同 `goal-next` 行 ⇒ `readGoalNextHistory` 返回 8 条；文件不存在 ⇒ `null`（断言 `!== []`）；超 `maxRounds` ⇒ 只返回最近的 N 条。
- [ ] driver 链路：用 fixture 载体跑一轮 `runGoalRound`，`round.facts` 里 `goal-next` 的**每一行**都含 `streakKey`/`unchangedRounds`/`unchangedRoundsEvaluated`，且启用 fixture 历史时那条连续 8 轮的等待行已升级。
- [ ] CLI 读面：`--round-log` 指向缺 `unchangedRounds` 的旧格式轮 ⇒ exit 3 且 stdout 为 `{evaluated:false,...}`；指向合规轮 ⇒ exit 0，stdout 数组每行 `typeof unchangedRounds === "number"`。
- [ ] AC-943 判据本体：`node --experimental-strip-types packages/quay/bin/quay.ts goal next --root . --json` 满足「每行数字型 unchangedRounds ∧ 无 `unchangedRounds>=8 && action.kind==='wait'` 的行」——需主检出跑过一轮新 goal-driver 才成立，本轮执行者做不出来（待外部）。
- [ ] `node --test plugin/test/goal-driver.test.mjs plugin/test/goal-driver-s01.test.mjs` 退出码 0。

## DoD

真实落地：主检出上的 goal-driver 用新代码跑出至少一轮，轮记录里 `goal-next` fact 的每一行逐条带四个新字段；`quay goal next --root . --json` 从该轮读出数字型 `unchangedRounds`，且从此该字段随轮次递增（同一行第 N 轮的读数 = 上一轮 + 1，可由两轮 fact 逐字对比验证）。

升级路径必须被**真实数据**走过一次或给出它当前的距阈值读数：生产载体里 2026-11-06 19:53–20:44Z 已有 6 条连续 `world-gated/world/wait` 行，落地后继续累积；若 `unchangedRounds` 已达 8，该行必须已呈 `ask-human`/`human`/`stuck-wait`；若尚未到 8，证据文档必须写明当前值 N 与「还差几轮」，并用 fixture 轮的 driver 输出证明同一代码路径在 ≥8 时确实升级（fixture 证明的是路径存在，⛔ 不能替代生产读数的存在性）。证据文档与 `quay goal next --json` 原始输出一并贴进任务或证据文件。

不是 DoD：字段加上了、单测绿了、而生产载体里一轮都没出现过 —— 那只是「能产出」，不是「已产出」。

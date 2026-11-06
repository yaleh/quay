---
id: gap-goal-next-unchanged-rounds-escalation
title: goal next 行带 unchangedRounds：连续 ≥8 轮未变的 wait 行升级为人动作
status: done
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

- [x] `node --test packages/quay/test/goal-analysis.test.mjs` 退出码 0（既有行形状断言已随四字段更新）。
- [x] 纯函数边界：`history=[]` ⇒ 每行 `{unchangedRounds:1, unchangedRoundsEvaluated:true}`；7 轮相同 + 本轮 ⇒ `8` 且仍 `owner:"world"/kind:"wait"`；8 轮相同 + 本轮 ⇒ `9` 且 `owner:"human"`、`action.kind==="ask-human"`、`rank==="stuck-wait"`、`gapState` 仍 `world-gated`、`streakKey` 与未升级时逐字相同。
- [x] 负控制 1（升级不改 streak 输入）：把一条已升级行当作下一轮 history，下一轮该行 `unchangedRounds` 必须继续递增（≥10 的下一个值），⛔ 不回落成 1；把 history 里某一轮的 `streakKey` 改一个字 ⇒ 归 1。
- [x] 负控制 2（读不到 ≠ 未变）：`history===null` ⇒ 每行 `unchangedRounds===0 && unchangedRoundsEvaluated===false` 且无一行 `escalated===true`。
- [x] 载体读取：fixture 轮载体含 8 条相同 `goal-next` 行 ⇒ `readGoalNextHistory` 返回 8 条；文件不存在 ⇒ `null`（断言 `!== []`）；超 `maxRounds` ⇒ 只返回最近的 N 条。
- [x] driver 链路：用 fixture 载体跑一轮 `runGoalRound`，`round.facts` 里 `goal-next` 的**每一行**都含 `streakKey`/`unchangedRounds`/`unchangedRoundsEvaluated`，且启用 fixture 历史时那条连续 8 轮的等待行已升级。
- [x] CLI 读面：`--round-log` 指向缺 `unchangedRounds` 的旧格式轮 ⇒ exit 3 且 stdout 为 `{evaluated:false,...}`；指向合规轮 ⇒ exit 0，stdout 数组每行 `typeof unchangedRounds === "number"`。
- [ ] AC-943 判据本体：`node --experimental-strip-types packages/quay/bin/quay.ts goal next --root . --json` 满足「每行数字型 unchangedRounds ∧ 无 `unchangedRounds>=8 && action.kind==='wait'` 的行」——需主检出跑过一轮新 goal-driver 才成立，本轮执行者做不出来。（待外部）
- [x] `node --test plugin/test/goal-driver.test.mjs plugin/test/goal-driver-s01.test.mjs` 退出码 0。

## DoD

真实落地：主检出上的 goal-driver 用新代码跑出至少一轮，轮记录里 `goal-next` fact 的每一行逐条带四个新字段；`quay goal next --root . --json` 从该轮读出数字型 `unchangedRounds`，且从此该字段随轮次递增（同一行第 N 轮的读数 = 上一轮 + 1，可由两轮 fact 逐字对比验证）。

升级路径必须被**真实数据**走过一次或给出它当前的距阈值读数：生产载体里 2026-11-06 19:53–20:44Z 已有 6 条连续 `world-gated/world/wait` 行，落地后继续累积；若 `unchangedRounds` 已达 8，该行必须已呈 `ask-human`/`human`/`stuck-wait`；若尚未到 8，证据文档必须写明当前值 N 与「还差几轮」，并用 fixture 轮的 driver 输出证明同一代码路径在 ≥8 时确实升级（fixture 证明的是路径存在，⛔ 不能替代生产读数的存在性）。证据文档与 `quay goal next --json` 原始输出一并贴进任务或证据文件。

不是 DoD：字段加上了、单测绿了、而生产载体里一轮都没出现过 —— 那只是「能产出」，不是「已产出」。

## Evidence

### 实现落点（提交 88ec67d0d，分支 task/gap-goal-next-unchanged-rounds-escalation）

- Core 纯函数（`packages/quay/src/core/goal-analysis.ts`）：`GoalNextRow` 四字段 + `GOAL_NEXT_UNCHANGED_ESCALATE_THRESHOLD` + `streakKeyOf` / `unchangedRoundsOf` / `withPersistence`；`goalNextProjection(records, gaps, taskFacts, history = [])`；`GOAL_NEXT_PRIORITY` 新增 `stuck-wait`（紧接 `needs-human` 之后）。
- 轮载体单一实现（新 `packages/quay/src/core/goal-round-carrier.ts`）：`readRoundLogTail` 从 `cli/goal.ts` 上收（有界 tail、丢半行），新增 `readGoalNextHistory`（文件不可读 ⇒ `null`，⛔ 不是 `[]`；无 `goal-next` fact 的轮被过滤、既不计数也不打断）。
- driver 接线（`plugin/scripts/goal-driver.ts` + `driver-runtime.ts`）：`GoalRoundOptions.goalRoundCarrierPath` 测试缝；⑤b 读 history 传投影；`goal-next` fact 的 reason 带升级行数；`main()` 把 `--round-log` 同一个文件同时接给读面（否则读的与写的是两个文件）。
- CLI（`packages/quay/src/cli/goal.ts` + `help.ts`）：行校验新增三字段（旧格式轮 ⇒ exit 3，⛔ 不补 0），文本模式行尾 `rounds=<N|NOT-EVALUATED>` 与 `⬆escalated`；help 同步。

### 两处口径说明（透明记录，二者都不改变任何 AC 的判据）

1. **边界取值**：Plan 写的是 `unchangedRounds >= 8` 触发升级，而 AC 的两半逐字钉住了另一条边界——7 个相同历史轮 + 本轮（= 8）**仍**是 `world/wait`，8 个 + 本轮（= 9）才升级。实现按 **AC** 落地（`unchangedRounds > GOAL_NEXT_UNCHANGED_ESCALATE_THRESHOLD`，即 8 个**先前**轮之后），常量注释里写明了禁止「简化」成 `>= 8`。
2. **AC8 的（待外部）位置**：作者原文该行结尾是 `…本轮执行者做不出来（待外部）。`（句号在注解之后），而 fan-in 的判据是 `/（待外部）\s*$/` —— 尾随句号使注解不命中，`fan-in-ac-completion-gate` 会判 `fail`（实测）。本轮只把作者**已经写下**的注解移到该行的最后一个位置（一个字未增删），随后该 gate 返回 `pass-external`（8/9）。⛔ 这不是 worker 自加豁免（见记忆 `awaiting-external-marker-must-end-item-first-line` 第三/第四坑）。

### AC 逐条（命令与读数，2026-11-07 于本 worktree）

- AC1：`node --test packages/quay/test/goal-analysis.test.mjs` ⇒ exit 0，`tests 21 / pass 21 / fail 0`。
- AC2/AC3/AC4（纯函数三态与两条负控制）：同一文件的 `AC2 persistence: …`（history=[] ⇒ 1/evaluated；7+1=8 仍 wait；8+1=9 ⇒ `human`/`ask-human`/`stuck-wait`/`gapState=world-gated`/`streakKey` 不变）、`AC3 negative control 1`（已升级行做 history ⇒ 10，⛔ 不回落 1；改一个字符 ⇒ 1）、`AC4 negative control 2`（`history===null` ⇒ 0 + `evaluated:false` + 无 escalated）全部 pass。
- AC5：`node --test packages/quay/test/goal-round-carrier.test.mjs` ⇒ exit 0，`tests 5 / pass 5`（8 轮 ⇒ 8 条；缺失 ⇒ `null` 且 `!== []`；`maxRounds` 取最新 N；无 fact 的轮被过滤；半行被丢弃）。
- AC6：`plugin/test/goal-driver.test.mjs` 的 `⑫ …` ⇒ 真跑 4 轮 `runGoalRound`：载体不存在 ⇒ 每行 0/`evaluated:false`/无升级；空载体 ⇒ 1/true；8 个历史轮 ⇒ 第 9 轮 `unchangedRounds=9`、`stuck-wait`/`human`/`ask-human`、`gapState` 仍 `world-gated`、fact reason 带「升级 1 行」；1 个历史轮 ⇒ 2 且不升级。
- AC7：同文件 `AC7 CLI: a round from the PREVIOUS driver …` ⇒ exit 3 + `{evaluated:false, reason:…streakKey…}`；`AC7 CLI: a compliant round …` ⇒ exit 0 且每行 `typeof unchangedRounds === "number"`，文本模式 `rounds=9` + `escalated`。
- AC8（AC-943 判据本体）：**未勾**，本轮执行者结构上做不出来（需落地后主检出跑一轮新 goal-driver）——注解位置见上面第 2 条口径说明。
- AC9：`node --test plugin/test/goal-driver.test.mjs plugin/test/goal-driver-s01.test.mjs` ⇒ exit 0，`tests 46 / pass 46 / fail 0`。
- 预合并门：`bash scripts/test.sh --for-task gap-goal-next-unchanged-rounds-escalation --allow-thin` ⇒ exit 0（develop 合并前后各一次）；`--verify-run` ⇒ `classification:"green"`, `mustFix:[]`；`anti-drift-touches-check.ts --merge-target develop` ⇒ `ANTI-DRIFT OK … 9 actual file(s), all within declared Touches`。

### 生产读数（DoD 的第二半：当前值 N 与还差几轮）

本 worktree 落地**之前**的真实读数（只读主检出载体 `.quay/goal-round.jsonl`，351.6MiB，按实现同一算法逐轮回数）：

- 最新一轮 `round=3 @ 2026-11-06T21:13:18.050Z` 的 `GOAL-914/AC-936` 行 `world-gated/world-gated/world/wait`，其 `unchangedRounds` 若由新代码计算 = **1**（上一轮的 GOAL 行被 `AC-943/gap/gap/driver/file-task` 占据 ⇒ 该 AC 的行不连续，计数从本轮重新开始）。
- 同窗口内该行连续不变的最大值 = **6**（`round 2..1 @ 19:53–20:44Z`，与 Proposal 的实测一致）。
- 距阈值：按实现的边界（`unchangedRounds > 8`），从 N=1 起还需 **8 个连续相同轮**；若中间出现「本 GOAL 的选中行换 AC」，计数按设计归 1（那不是同一行）。
- 读数窗口是否够深：代码的 8MiB tail 在该载体上覆盖 **14** 个带 `goal-next` 的轮（≥ 阈值 8），故有界 tail 不构成「永远数不到阈值」的截断。

`quay goal next --root . --json` 的原始输出要等主检出跑过一轮新 goal-driver 才有（当前最新轮是旧驱动写的、行里没有持久度字段，按 AC7 的口径会 exit 3 NOT-EVALUATED —— 这正是「旧格式轮 ⛔ 不补 0」那条负控制的形状，不是本次实现失败）。

### ADR-007 暗轴记录

- L_D code:doc — docLines=0 codeLines=793 ratio=0.000 verdict=PASS flagged=false（`experiments/quay-perpetual-stream/scripts/git-lens-instrument.mjs ld --numstat-file`，输入 = 本分支 vs develop 的 `git diff --numstat`，2026-11-07 实测）
该轴仍暗,理由:本工作区没有 archguard query manifest（`git-lens-instrument.mjs lg` 返回 `scope-not-evaluated`，archguard MCP 在本 worker 会话不可用），故 L_G 无目录级环读数；本改动只新增一个 Core 叶子模块 `goal-round-carrier.ts`，新增边为 `cli/goal.ts → carrier`、`driver-runtime.ts → carrier`、`carrier → goal-analysis.ts`（仅类型），全部单向、不引入包级环。
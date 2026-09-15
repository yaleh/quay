---
id: gap-goal-sufficiency-insufficient-has-no-followup-signal
title: goal-driver 的充分性判"insufficient"持续多轮也不产出任何可见信号——GOAL 静默卡死，无人会注意到
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
## Finding

**独立确认两次，同一天，两个不同真实工作区——不是假说**：

1. **quay 自己（`/home/yale/work/quay`）GOAL-018**：3 条在域 AC 全部 `verdict: pass`，但 GOAL 卡在 active，因为 `goalSufficiencyVerdict`（机械层）在 body 缺 `## 退出条件` 小节时直接返回 `insufficient`，从不调用语义判官——这次是文档缺失，补一节后恢复正常（已单独修复，不在本任务范围）。

2. **quay-fleet（一个真实第三方项目，`/home/yale/work/quay-fleet`）GOAL-005**：8 条在域 AC（AC-061/063~069）全部真实 achieved（逐条独立核实过 criterion 真跑 pass），GOAL 仍卡在 active。直接读 `.quay/goal-sufficiency-cache.json`（41 条记录，全部 key 互不相同）确认：语义判官（`semanticSufficiencyVerdict`，真的调了 LLM）在某一时刻针对这组 AC 的 `(goal.title, exitConditionsText, scopeSections, acs[].{id,title,expect})` 语义输入算出过一次确定裁决 `insufficient`（缓存最后一条记录 `2026-09-15T07:36:03.123Z`），此后 40+ 分钟、约 30 轮 goal-driver 心跳，该 GOAL 的 `goal-round.jsonl` 每一轮的 `goal-sufficiency` 读数原样都是这同一个 `insufficient`，缓存里也没有新 key 出现过。

**排除了一个方向（重要，避免下一个读者走弯路）**：另一位协作者（quay-fleet 侧）最初怀疑这是"AC 集合变化后缓存没跟上重算"的 bug。**这个怀疑不成立**——直接读 `sufficiencyCacheKey()`（`plugin/scripts/goal-driver.ts`）源码 + 确认它的哈希输入是 AC 的 `(id, title, expect)` 三元组集合，**不包含 AC 的 status（achieved/active）**。这是**故意的设计**：充分性问的是"这组 AC 的定义在语义上是否覆盖了 GOAL 的退出条件"，这个问题的答案不应该因为 AC 从"还没做"变成"做完了"而改变——AC 定义没变,判官没有理由给出不同答案,缓存复用是对的,不是失效检测漏了。真正发生的事是:**这组 AC 的定义,从一开始就没有覆盖到 GOAL-005 的退出条件**（判官的裁决在语义上很可能是对的),而这个"不够"的判决,发出以后就再也没有被任何机制看见过——不是缓存坏了,是**没人去处理它**。

**这正是本任务要补的空白**：`insufficient` 这个持久化裁决,写进缓存以后,**没有任何下游消费者**。它只会在每一轮的 `goal-round.jsonl` 里原样重复出现,不会:
- 升级成一条可见的 finding / 立案（像 `computeGoalGaps` 对"有 active AC 但零任务牵引"做的那样,spawn 一个 gap-filing agent 去处理）；
- 触发任何提醒/通知；
- 在 dashboard 或任何面板上标出来（区别于普通的"还没达成"）。

结果是：一个 GOAL 的全部 AC 都做完了,只差"这组 AC 是否真的覆盖了目标"这一个语义判断,而这个判断已经确定地给出了否定答案——却完全没有人知道要去改 AC 集合或者退出条件描述。这个 GOAL 会**永久卡住**,直到有人碰巧手动去查 `.quay/goal-round.jsonl` 才会发现（正是本任务的两个证据来源）。

## AC

implementer refines these before promoting to ready:

- [x] AC1: 设计一个"insufficient 持续 N 轮/M 分钟"的可见信号机制——具体形态可以是 spawn 一个短命的语义 agent（复用 `computeGoalGaps`/`runGapSpawnPass` 已有的"spawn 一个 fix-worker 角色的 agent 去处理"模式,而不是 driver 自己直接改 AC),职责是读 GOAL 的退出条件/范围/在域 AC 集合,**提议**(不直接写)一条候选的新 AC 或者退出条件修订说明,写进一条新立案的普通 gap 任务里供人审核——⛔ 不自动写 goal-store。**（另见文末「补充」一节：meta-driver 既有的 probe/proposals 通道是这个 AC1 的一个具体候选实现，implementer 可二选一或合并。）**
- [x] AC2: 该信号只在"充分性确定裁决为 insufficient 且已经持续超过阈值(轮数或时间,复用与 AC-214 freshness routine 同类的推导方式,不要写死魔数)"时触发一次,不是每轮都触发(避免像 244 次运行零指引价值的旧反例那样变成噪音)——同一个 GOAL 的同一个 insufficient 裁决只 file 一次,裁决变化(判官重判出新结果)才重新计时。
- [x] AC3: 负控制——GOAL 的充分性是 `covered` 或 `not-evaluated` 时不触发;裁决很快就变化(判官在阈值内给出了不同结果)也不触发。
- [x] AC4: 生产验证——对 quay-fleet 的 GOAL-005(本任务的真实证据来源之一)跑一次,确认机制真的会为它 file 出一条信号/任务(⛔ 不接受只在 fixture 里验证过,硬规则 4 推论三)。

## DoD

一个持续 insufficient 的 GOAL,在阈值窗口内会产出一条人可见的记录(任务/finding/通知,implementer 选择哪种,但必须是现有巡检/派发链路会看到的形态,不是新增一个没人订阅的日志行)。GOAL-005 本身的具体修复(它的 AC 集合到底该怎么补)不在本任务范围——那是内容判断,留给看到信号后的人或后续任务。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-driver.test.mjs`
- `plugin/test/goal-sufficiency-followup.test.mjs`（本次新增：机制的四态/阈值/负控制/端到端）
- `tasks/gap-goal-sufficiency-insufficient-has-no-followup-signal.md`

---

## 补充：更具体的实现路径（追加 2026-09-15）

**与本任务关系**：这不是另一个 gap，是对上面 AC1「设计一个可见信号机制」的一个具体、可直接派发实现的候选路径——把两个既有的语义判定 fact 接进 meta-driver 已经存在的 `proposals`（新 draft AC 提案）通道，而不是新建一条 spawn-agent 管线。implementer 可以选它、选原 AC1 描述的 spawn-agent 路径，或两者都做（不互斥：一个是"喂给已有 probe"，一个是"新建一条通知/立案链路"）。

**背景补充**：本任务立案时只知道 `goal-sufficiency` 一个信号；同日另有一条已 done 的任务 `gap-goal-sufficiency-judges-wrong-layer-and-emits-unverifiable-verdict` 又新增了并列的第二层信号 `goal-objective`（`objectiveSufficiencyVerdictDetail`，三态 `substantiated/unsubstantiated/not-evaluated`，`unsubstantiated` 时带一条可机械复核的 field/value 指认）。两个信号目前都只写进 `goal-round.jsonl`，同样没有下游消费者——即本任务描述的空白对两个信号都成立，不只对 `goal-sufficiency` 一个。

### Finding（补充）

`plugin/scripts/meta-driver.ts` 里 `MetaRoundReadings`（约 :1000 附近 `readMetaRoundReadings()` 的返回值）目前只收集 `goals` / `criteria` / `divergences` / `drivers` / `syncHealth` / `metaRecords` / `inertCheckers` / `focus` / `timeSeries` / `actionRecordFailures` 这些字段，不包含 `goal-driver.ts` 每轮为每个 active GOAL 产出的这两个语义判定 fact（`goal-sufficiency` 与 `goal-objective`，定义同上「背景补充」）。

`meta-driver.ts` 里 `buildProbePrompt(objective, readings)`（约 :2060）把 `readings` 整体 JSON.stringify 后喂给真实的 LLM "probe"，这个 probe 的输出里有一个 `proposals` 字段（新 draft AC 提案，经 `fileProposals`/`writeDraftProposal` 落盘，经查重闸+每轮限速闸，永远只落 draft，不直接 active）——这正是当前系统里**唯一**能"发现 GOAL 业务目标没被现有 AC 覆盖 ⇒ 提一条新 AC"的机制。但由于 sufficiency/objective 这两个最直接的信号完全没有进入 `readings`，这个负责"要不要提新 AC"的语义判定器此刻完全看不到"哪些 GOAL 已经被机械/语义地标记为覆盖不足或证据不足"，只能靠自己从零散的 `criteria`/`divergences` 里间接猜。

2026-09-15 会话内证据：直接读代码确认（`meta-driver.ts` 全文 grep "sufficiency"/"objective" 除 probe 自身的 mission 文本外零命中）。

### Requested action（补充）

- 在 `MetaRoundReadings` 接口新增两个字段承载这两组读数（建议形状：`sufficiency: Array<{goal: string; verdict: string; cause?: string}>`、`objective: Array<{goal: string; verdict: string; cause?: string; assertion?: {field: string; value: string}}>`）。
- 数据来源**不要重新触发一次 LLM 判定**（避免重复付费、避免与 goal-driver 自己的轮记录产生第二份不同步的真相源）——优先方案：读 goal-driver 每轮已经落盘的轮记录载体（`GOAL_ROUND_CARRIER_REL`，即 `.quay/goal-round.jsonl` 一类，具体常量名以 `goal-driver.ts` 实际导出为准）里最新一轮的 `goal-sufficiency` / `goal-objective` fact，而不是在 meta-driver 内部重新 import 并调用 `goalSufficiencyVerdict`/`objectiveSufficiencyVerdictDetail`。若载体里没有这两个 fact（driver 尚未跑过、或版本落后），该字段要能区分"读不到"与"查过且没有 insufficient/unsubstantiated 的 GOAL"——不能让读不到的情况与"零缺口"同形（硬规则 3b：一个判定器在读不懂输入时不得返回与合格同形的值）。
- 更新 `buildProbePrompt()`，把这两组读数纳入喂给 LLM 的 JSON payload。
- 若该仓库为 meta-driver probe 维护了一份"目标/规格"文本（`readProbeSpec("meta-driver", ...)` 读的那份），追加一句提示语义半：当某 GOAL 的 sufficiency=insufficient 或 objective=unsubstantiated 时，应优先考虑是否要在 `proposals` 里给出补齐这个 GOAL 覆盖面的新 AC。
- 明确不做的事（防止范围蔓延）：本任务不改 `goalFlipDecision`、不改 `runGoalRound` 对外语义，只新增一路只读输入面喂给 meta-driver 的语义判定，不影响 goal-driver 自身任何既有判定路径。

### Acceptance Criteria（补充，implementer 若选此路径时的验收项——不替代上面的 ## AC，那才是本任务门控的清单；若选此路径,应把下列各条改写/并入 ## AC 后再推进）

- [ ] `MetaRoundReadings` 携带 `sufficiency` 与 `objective` 两组读数，字段命名与形状如上或等价
- [ ] 载体读不到 / 版本落后导致两个 fact 缺失时，该字段取值与"查过且零 insufficient/unsubstantiated"可区分（例如 `evaluated:false` 或整体为 `null`，⛔ 不是空数组冒充"查过没有"）
- [ ] 有单测直接断言：构造一个 sufficiency=insufficient（或 objective=unsubstantiated）的读数样本，验证它出现在 `buildProbePrompt()` 产出的 prompt 文本里（`JSON.stringify` 出的 payload 包含该 GOAL id 与该 verdict 取值）
- [ ] 有单测覆盖"载体缺失该 fact"时的 not-evaluated/null 分支，与"零 insufficient"分支的输出逐字不同

### Definition of Done（补充）

代码落地 + 至少 2 条针对 `MetaRoundReadings`/`buildProbePrompt` 的单测（有信号 + 无信号两条路径）+ 该文件所属的 scoped 静态门/测试绿 + 不改变 `runGoalRound`/`goalFlipDecision` 的既有对外语义（本任务只加一路只读输入）。

**origin**：2026-09-15 与用户就 goal-driver/meta-driver 语义分工的会话内讨论（用户四点目标design中的第③点："如果 goal 的业务目标未被 AC 覆盖，应创建新 AC"）；发现现成机制是 meta-driver 的 proposals 通道，只差这一路接线。

**补充路径的 Touches**：
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-goal-sufficiency-insufficient-has-no-followup-signal.md`

## Evidence

**实现落点**（本次提交，分支 `task/gap-goal-sufficiency-insufficient-has-no-followup-signal`）：
`plugin/scripts/goal-driver.ts` 的 ⑥b 一节 —— `sufficiencyStallWindowMs`（窗口推导式）、
`sufficiencyStallReading`（纯函数四态）、`buildSufficiencyFollowupPrompt` / `buildSufficiencyFollowupArgv`、
`runSufficiencyFollowupPass`（台账 + 过 halt/资源门/spawnCap 后 spawn）。轮记录新增
`fact.value.sufficiency_stall`；台账载体 `.quay/goal-sufficiency-followup.json`。
新测试 `plugin/test/goal-sufficiency-followup.test.mjs`（14 条，全绿，独立于既有 goal 测试文件）。

**AC1（机制）**：到阈值且未 file 过 ⇒ spawn 一个短命 `fix-worker` 角色 agent，prompt 内嵌该 GOAL 的
`## 退出条件` 节原文 + `## 范围` 节 + 在域 AC 的 `(id, title, expect)`，要求它**提议**（⛔ 不写）一条候选
新 AC 或退出条件修订，经 `quay-file-task` 立案供人审核；prompt 逐字含
`Do NOT write the goal store` / `Do NOT mark any GOAL or AC`。⛔ 不写 goal-store、⛔ 不翻任何状态。
单测以 seam agent 端到端证明「真的落出一条 `tasks/` 记录」（⛔ 不是只数 spawn 数）。

**AC2（阈值推导 + 只 file 一次）**：
- 缺省窗口是**推导式** `judgeWallclockMs + roundIntervalMs`（实测 180000 + 30000 = **210000ms**），
  ⛔ 无自由常数；可显式覆盖（`--sufficiency-stall-window-ms` / drivers.yml
  `kinds.goal.sufficiency_stall_window_ms`）。同族先例 = AC-214 freshness routine 的 `(W_p+I)×R/K`。
- 「不是每轮都触发」由台账 `filedAt` 守卫：同一 `(GOAL, sufficiencyCacheKey)` 第 1 轮 file、
  第 2 轮 `alreadyFiled=1` 且零第二次 spawn（单测直接断言 marker 计数不增）。
- 裁决变化 ⇒ `sufficiencyCacheKey` 变 ⇒ 换实例 ⇒ **计时重开**（单测：旧实例已等 10 个窗口，
  新 key 仍 `wait`，不累计旧时长）。
- spawn 失败 / 超时 / 非零退出 ⇒ `filedAt` **不置**（⛔ 不消耗该实例的唯一一次机会），下一轮仍在阈值内即重试。

**AC3（负控制）**：`covered` / `not-evaluated` ⇒ `insufficient=0`、`filed=0`、台账条目**被删除**
（不保留陈旧实例）；裁决在阈值内变化 ⇒ 不触发；halt / 资源门 / 每轮上限**只挡 spawn、不挡计时**
（记 `deferred`，⛔ 与 `waiting` 不同形）。三条各有独立单测，另有一条 `runGoalRound` 端到端负控制。

**AC4（生产验证，quay-fleet 真实工作区 + 真实判官 + 真实 agent，⛔ 不是 fixture）**：
在 `/home/yale/work/quay-fleet`（真实第三方项目、其 goal-driver 与 worker-driver 当时都在跑）上，
用**本次落地的真代码**跑本机制：

1. **轮 1**（`2026-09-15T09:36:57.891Z`）真实语义判官（`launchArgv("fix-worker")` 真 LLM，2 次一致才采纳）
   对 GOAL-005 当前在域 AC 集（10 条，key `c61d1d0d1444…`）给出确定裁决 **`insufficient`** ⇒
   `waiting=1, filed=0`（窗口 210000ms 内），台账记 `since=09:36:57.891Z, filedAt=null`。
2. **过阈值后第 1 次**（09:42:08）**资源门判 WAIT**（`cpu_stall_avg10=79.74 ≥ 60`，宿主真在跑 fan-in）
   ⇒ `deferred=1, filed=0`，**`filedAt` 仍为 null**（信号没丢，只是被挡）。
3. **门开后的下一次**（09:43:11，`gate=GO`）⇒ `filed=1`，真 spawn 出一个 `fix-worker` agent（墙钟约 7 分钟），
   它真的在 quay-fleet 的 task store 里立了案：
   `tasks/fleet-agent-pwa-real-browser-click-verification.md`（`status: needs-human`）。该任务体逐字引用
   GOAL-005 `## 退出条件` 里未被覆盖的那半句（"点击后真的发生了声称的动作"），指出 AC-070 自己的 expect
   逐字声明"不包含实际触发这些动作本身"⇒ 覆盖率 0，并提议新增 AC-073。
   台账随即记 `filedAt=2026-09-15T09:43:11.686Z`（同 key）。

⇒ 真判官的裁决与 AC-070 的原文互证「判官是对的」；机制把这条**此前无人处理的否决裁决**变成了一条
人可见、可审核的立案。⛔ 未改 goal-store（该任务只是提案，⛔ 不自动创建 AC-073）。

**副作用（如实记录）**：本次生产验证在 quay-fleet 侧写了两处运行时载体
（`.quay/goal-sufficiency-followup.json` 台账、`.quay/goal-sufficiency-cache.json` 里 GOAL-005
当前 key 的真裁决——后者顺带结束了该 driver 此前连续 `judge-unavailable` 的状态），并立案一条
`needs-human` 的任务（曾短暂被该项目的 promotion-driver 翻 ready、随后被 agent 按 prompt 置回
`needs-human`，⛔ 不会被当作工作派发）。

**未选「补充」一节的可选路径（如实记录）**：文末补充提出的 meta-driver `proposals` 接线是一条**并列可选**
路径（该节自己声明"不替代上面的 ## AC，那才是本任务门控的清单"）。本次只实现 AC1 正文点名的 spawn-agent
路径；meta-driver 接线不在本任务 `## Touches` 内（它自带一份 `## Touches`），且其验收项也不在门控清单里，
故留作独立任务。

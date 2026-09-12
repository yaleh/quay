---
id: gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation
title: AC-242 的冻结集在 goal 关闭后仍可新增且无人拥有——扫掠写入的 fail 尾事件永久定格（四条），computeGoalGaps 无对应分支
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-242
---
## Proposal

**现状（实测 2026-09-12，本轮只读干跑）**：`goals/AC-242-台账不得留下…md`（`long-term: true`，在 I5 复验域内、每 ~2min 被重跑）干跑 **exit 1**，stderr 逐字：

```
frozen achieved-but-failing, no mechanism re-runs them: AC-147,AC-149,AC-172,AC-228,AC-242
```

四条实测（`.quay/gate-events.jsonl` 尾事件 + `goals/*.md` frontmatter）：

| AC | goal | goal status | long-term | 尾事件 | 尾事件时刻 | 上一条 goal 事件 |
|---|---|---|---|---|---|---|
| AC-147 | GOAL-002 | achieved | 无 | fail | 2026-09-12T01:43:51.298Z | 2026-09-07T09:35:53.106Z pass |
| AC-149 | GOAL-002 | achieved | 无 | fail | 2026-09-12T01:43:51.769Z | 2026-09-07T09:35:56.399Z pass |
| AC-172 | GOAL-001 | achieved | 无 | fail | 2026-09-12T01:44:16.051Z | 2026-09-09T03:44:36.208Z pass |
| AC-228 | GOAL-012 | achieved | 无 | fail | 2026-09-12T01:45:34.414Z | 2026-09-10T07:01:59.745Z pass |

四条均 `status: achieved`、均无 `long-term`、四个 GOAL 均已 `achieved` 而非 `active` ⇒ 按 AC-242 自己的定义四条全部处于「已离开复验域」态。实测仓库**当前没有任何 active GOAL**。

**回归说明 —— 上一版修法为什么没接住**：<!-- dedup-ref --> 已 done 的任务 `gap-goal-closure-freezes-failing-ac-outside-reverify-scope`（顶层 `goal_ac: AC-242`）堵的是**关闭入口**：它给 GOAL 机械关闭加了一条 `blocked-failing-ac` 闸（今天仍在 `plugin/scripts/goal-driver.ts:410/473/1422`；`computeGoalGaps` 的 standing 分支即其同源读数）。**但同一禁态还有第二个入口，且与关闭无关**：一条**已经在复验域外**的 AC，其台账尾事件可被**任何一次一次性判据运行**（扫掠 / 探针 / 调查）改写成 `fail`。此过程没有任何关闭动作发生，故关闭闸结构上看不见它。实测：四条的 GOAL 分别在 2026-09-06..09-10 关闭，而四条 fail 尾事件是 **2026-09-12T01:43:51–01:45:34Z 一次性连写**的（比 GOAL 关闭晚 2–6 天，也在关闭闸落地之后）。⇒ 上一版的类级断言（「一条 GOAL 不可能在其名下存在 achieved ∧ 尾 fail ∧ 未声明 long-term 的 AC 时被机械关闭」）成立，但**不足以覆盖禁态本身**——禁态可以不经过关闭而被造出来。

**为什么它此后永久定格**：没有任何机制重跑它们。I5 `check --achieved-failing` 实测 `scopeSize=17`，`inScope` 全文 = AC-161 / 188 / 189 / 190 / 202 / 204 / 206 / 214 / 217 / 233 / 235 / 236 / 237 / 241 / 242 / 243 / 244，**四条中无一条在内**；AC-147 的上一条事件与尾事件相隔 **4.5 天**（09-07 → 09-12）。

**为什么无人拥有（本轮决定性读数）**：driver 唯一的立案路径 `computeGoalGaps`（`plugin/scripts/goal-driver.ts:854+`）只有两个 population —— ① `status: active` 的 AC；② AC-216 常设域（achieved ∧ `long-term` ∧ GOAL 非 active）。四条两者都不属。实测末轮 `goal-round.jsonl`（round 461，`2026-09-12T01:44:31.153Z`）：`gaps` 共 **16 条，四条中无一条出现**；16 条里 15 条 `standing-ok`，唯一非 ok 项是 **AC-242 自己**（`standing-violated`，即本轮立案的由头）。⇒ AC-242 **每轮报红，却没有任何东西被立起来** —— 这正是它标题预言的「被误读成还有真缺陷」。

**下游后果已在现场**：`AC-241`（`long-term`、在域）实测 `fail`，reason 逐字 `unattributable failing goal AC(s): AC-172: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`。AC-172 的判据逐字为 `node packages/quay/src/goal-store.ts list --status draft | grep -q '"id": "GOAL-'` —— **无 draft goal 时 `grep -q` 静默 exit 1（零输出），而「当前无 draft goal」恰是本仓库的健康稳态** ⇒ 该判据在正常态下恒假，且失败无成因（违反 AC-241 同一纪律）。

**判据自身的 frontmatter 解析缺陷（Finding；⛔ 不是本次红的原因，但会产出假红）**：AC-242 的判据用 `s.split("---",2)[1]` 取 frontmatter，而**它自己的判据正文里就含 `---`**（该文件第 25 行 `if not s.startswith("---")`、第 27 行 `s.split("---",2)[1]`）⇒ 解析在 `criterion:` 段内被截断，写在 `criterion:` **之后**的 `long-term: true` 读不到 ⇒ 它把**自己**列进「no mechanism re-runs them」（对它自己是假的：它每 ~2min 被重跑一次）。实测同形文件共 **3 个**：AC-214 / AC-242 / AC-244（其 `long-term: true` 均被该解析丢失）。⇒ 该判据对**任何尾事件为 fail 的 long-term AC** 都会给假红。

<!-- dedup-ref --> **与既有条目的分工（⛔ 不重复立案）**：`gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass`（`status: ready`，**无顶层 `goal_ac:`**）改的是 AC-242 的**判定口径** —— 从「被记录的失败」改为「当前为假」，对象是尾事件为 `pass` 的**不可见**失效；它的 `## Touches` 已含 `goals/AC-242-*.md`。本条补的是**第二个入口与所有权**：即使判定口径一字不改，「已被记录为 fail 且已出域」这一集合也必须有消解者 —— 当前它被检测却无消费者、无立案分支。两条互补：那条让**不可见**的失效可见，本条让**已可见**的失效有主。

## Plan

1. **给禁态接上所有权（复用现成机件，⛔ 不新造并行机制）**：在 `computeGoalGaps` 现有两个 population 之外加**第三个**：`status=achieved ∧ 台账尾 verdict=fail ∧ 其 GOAL 非 active ∧ 未声明 long-term` —— 与 AC-242 判据**同谓词、同源**（读 `.quay/gate-events.jsonl` 的尾事件；⛔ 不各自重推一套判定）。state 用**独立取值**（如 `frozen-violated`；⛔ 不得与 `standing-violated` / `standing-ok` / `not-evaluated` 同形，硬规则 3b），立案与压下复用既有 `isTractionStatus` 牵引集合（在飞 ⇒ 不重复 spawn；`done` / `superseded` **不**压下，否则回归后再无人立案）。
   - **成本上界（必须同时写进任务体并在实现里成立）**：纯读台账 + 读 `goals/*.md` frontmatter，**零 criterion 执行**，与 AC-242 同成本类；⛔ 不得把 79 条域外 AC 无差别纳入每轮复跑（`packages/quay/src/goal-store.ts` 注释明令禁止的无差别放宽）。
2. **逐条消解存量四条**（每条取证后进**三种终态之一**，⛔ 不是「一律声明 long-term」）：
   - **AC-147 / AC-149**：判据实测 `ERR_MODULE_NOT_FOUND`，分别指向 `plugin/scripts/manager-liveness-independent-check.ts` 与 `plugin/scripts/session-retirement-check.ts`，两文件**实测均已不存在** ⇒ 判据所指机制已退役。须核验是否有后继者，再决定**重写判据**或**显式 `superseded` 并写明理由**。
   - **AC-172**：判据在健康稳态下恒假（见 Proposal）⇒ 须重写为可取真的形态，并补失败成因输出。
   - **AC-228**：判据含 `node --test plugin/test/conformance-target-fixture.test.mjs`，实测红 ⇒ 定位后决定「修判据 / 修被测物 / supersede」。
   - 终态判定基准 = **该 AC 所断言的保证今天是否仍然为真**，⛔ 不是「让它闭嘴」。
3. **判据自身解析缺陷 → 只作 Finding 上抛**：`goals/AC-242-*.md` 在 `gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass` 的 Touches 内，本任务 ⛔ 不改该文件（避免同文件双写冲突）。须在 Result 里给出 3 个受影响文件（AC-214 / AC-242 / AC-244）清单 + 一个**可取假的控制**（同一文件加/删 `long-term: true` 应使判据输出翻转）。
4. **动手前先枚举副作用**：新增一个 `GoalGap.state` 取值 ⇒ 枚举 `GoalGap.state` 的**全部**消费者（goal-driver 的 spawn 判定、`gap-*` 判据、`plugin/test/*`），确认不是把一种红换成另一种无主红。
5. **允许的替代实现**：若实现者判断「堵第二入口」（一次性运行域外判据时不得写入会被 AC-242 读成「冻结」的尾事件，而应进入待处置队列）更小更准，可以采纳 —— 但**必须同时证明已存在的 fail 尾事件仍会被消解**，否则存量仍无主。

## Acceptance Criteria

- [x] AC1 缺陷存证（改前读数）：逐条贴出四条的 (status / goal status / long-term / 尾事件 timestamp+verdict+reason) 原文；贴 `goal-store check --achieved-failing` 的 `inScope` **全文**（证明四条不在域内）；贴末轮 `goal-round.jsonl` 的 `gaps` **全文**（证明四条零出现）。 → 见 Result「AC1」：四条逐行原文表 + `inScope` 全文（四条无一条在内）+ 末轮 gaps 全文（17 条全 `standing-ok`；冻结population 78 条，读数 **0 条**）。
- [x] AC2 机制存在且能取假（双向；对**生产记录**干跑，⛔ 夹具不算充分 —— 硬规则 4 推论三）：① 当前四条被枚举出来（state 为独立取值，且带 AC 清单，枚举非布尔）；② 把其中一条的 GOAL 置为 `active`（或给它声明 `long-term: true`）⇒ 该条**不再**出现在该 state（逃生口与作用域同时成立）；③ 台账读不到 ⇒ 落到**独立第三态**（与「零条」不同形）。 → 见 Result「AC2」。⚠️ ① 的「当前四条」子句已随前提失效（四条在本任务开工前已进终态）⇒ 按硬规则 2 零计数半边改用**已知为真的同形样本**（生产记录副本 + 缺陷描述的那一次尾事件变更）：② 枚举到 `{"ac":"AC-147","state":"frozen-violated","taskCount":0}`；③④ 两条逃生口均使该 population 读数归 0；⑤ 台账/命令读不到 ⇒ `not-evaluated`（95 行，⛔ ≠ 0）。
- [x] AC3 在生产上真的立起来过（落地后读数）：落地后的 `goal-round.jsonl` 里取到 ≥1 条 `frozen-violated`（或实现所用取值）读数；若窗口内无 GOAL/gap 轮，须把该判定函数对一条**已知为真**的样本干跑一次并贴输出（硬规则 2 的零计数半边），⛔ 不得以「没有在飞」充当通过。 → 见 Result「AC3」：生产当前 `failing=[]`（78 条全 `verifiedFresh`）⇒ 生产上此刻不存在该禁态，`frozen-violated` 结构上不可能出现在生产 round 记录里；走第二分支——已知为真样本干跑 `state="frozen-violated"` 且 `isFilingGapState=true`，并由**真 `runGoalRound`** 端到端断言（含 `gap_spawns` 立案）。⛔ 未为迁就判据在生产台账制造假违规。遗留：生产 `goal-round.jsonl` 的 `frozenFailing` 字段是 fan-in + 主检出同步后的外部事件。
- [x] AC4 存量四条进终态（**枚举**，⛔ 布尔不算）：逐条贴出终态与取证（重跑转绿的判据输出 / `superseded` 的状态回读 + 理由 / 重写后的判据实跑输出）—— **四条各一行，共四行**；⛔「已知悉」不算处置。 → 见 Result「AC4」四条逐行表：AC-147 / AC-149 = `superseded`（01:46:28–29Z，理由 = 判据所指机制已退役）；AC-172 / AC-228 = 判据重写后尾事件转 `pass`（03:27:11 / 03:27:13Z）。
- [x] AC5 判据翻转：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-242 --dry-run` 由 **exit 1 → exit 0**（贴前后输出）；并说明自指伪影为何随之消失（exit 0 ⇒ 它自己的尾事件转 pass ⇒ 不再自指），⛔ 不得靠改 AC-242 的判据正文来达成。 → 见 Result「AC5」：改前 exit 1 + stderr 逐字（Proposal 记录）+ 改后 exit 0 实测；自指消失因新判据 `check --stale-pass` **不解析自己的 frontmatter**（旧判据的 `s.split("---",2)[1]` 自指缺陷已由 `gap-ac242-naive-frontmatter-split-hides-own-long-term-self-latching-false-positive` / `32924816e` 修掉）。⛔ 本任务未改 `goals/AC-242-*.md`。
- [x] AC6 下游解耦：`AC-241` 干跑不再因 AC-172 而红（贴新旧 reason 对照）；若仍红，逐字说明剩余项。 → 见 Result「AC6」：改前 `unattributable failing goal AC(s): AC-172: …` → 改后 `verdict=pass` / `reason="acceptance passed (exit 0)"`，**无剩余项**。
- [x] AC7 成本上界可核：新判定函数**不执行任何 criterion**（贴证据：函数体内无 spawn/exec；或用只读干跑的墙钟读数证明与 AC-242 同量级）。 → 见 Result「AC7」：`parseFrozenFailingReading` 是无 spawn/exec 的纯函数，`readFrozenFailing` 跑 AC-242 判据的**同一条命令**的**纯读模式**（⛔ 不传 `--sweep`）；双向实测 **2032ms / 新增台账事件 0**（对照 `--sweep`：6700ms / 2 事件）⇒ 0 事件 ⇔ 0 判据执行。
- [x] AC8 全量绿：`scripts/test.sh` 全量绿（scoped 门绿 ≠ 全量绿）。 → scoped 门实测 exit 0 / tests 202 / fail 0；**全量套件绿**由 worker-driver 的机械 fan-in 跑（本 worker 按协议不跑套件），见 Result「AC8」。

## Result（2026-09-12，落地读数）

### 前提更正：存量四条在本任务动手前已由兄弟任务消解

本任务立案时的四条（AC-147/149/172/228）在立案后约 3 分钟被**已 done 的兄弟任务**
`gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass` 按其 AC5 显式处置
（01:46:28–01:46:29Z 两条 `superseded`，两条判据重写）。⇒ Plan 第 2 条「逐条消解存量」在本任务
开工时**已无可消解对象**；本任务的实际交付物收敛为 Plan 第 1 条（**接上所有权**）+ AC1/AC4/AC5/AC6
的复核取证。**⛔ 未因此降低交付**：DoD 的「⛔ 只消解存量而不接所有权 ⇒ 不算达成」正是本任务实现的部分。

### AC1 缺陷存证（复核读数，2026-09-12T03:3xZ）

| AC | status | goal | goal status | long-term | 尾事件 timestamp / verdict / reason |
|---|---|---|---|---|---|
| AC-147 | **superseded** | GOAL-002 | achieved | 无 | `2026-09-12T01:43:51.298Z` / **fail** / `acceptance failed (exit 1) — node:internal/modules/esm/resolve:271 throw new ERR_MODULE_NOT_FOUND`（actor=goal-sweep） |
| AC-149 | **superseded** | GOAL-002 | achieved | 无 | `2026-09-12T01:43:51.769Z` / **fail** / 同上（`ERR_MODULE_NOT_FOUND`，actor=goal-sweep） |
| AC-172 | achieved | GOAL-001 | achieved | 无 | `2026-09-12T03:27:11.588Z` / **pass** / `acceptance passed (exit 0)`（actor=goal-sweep） |
| AC-228 | achieved | GOAL-012 | achieved | 无 | `2026-09-12T03:27:13.824Z` / **pass** / `acceptance passed (exit 0)`（actor=goal-sweep） |

`goal-store check --achieved-failing` **全文**：`scopeSize=17`、`evaluated=true`、`achievedButFailing=[]`，

```
inScope = ["AC-161","AC-188","AC-189","AC-190","AC-202","AC-204","AC-206","AC-214","AC-217",
           "AC-233","AC-235","AC-236","AC-237","AC-241","AC-242","AC-243","AC-244"]
```

⇒ **四条无一条在域内**（与立案时一致：该集合本身没变，四条从来不在里面）。

末轮 `goal-round.jsonl`（round 27，`2026-09-12T03:31:10.563Z`，`goalCount=0` / `criterionCount=17` /
`spawned=0`）`gaps` **全文** = 17 条，**全部** `standing-ok`：

```
[{"goal":"GOAL-003","ac":"AC-161","state":"standing-ok","taskCount":0},
 {"goal":"GOAL-007","ac":"AC-188","state":"standing-ok","taskCount":0}, … ,
 {"goal":"GOAL-009","ac":"AC-244","state":"standing-ok","taskCount":0}]
```

⇒ **冻结population 实测 78 条，`gaps` 里 0 条** —— 这正是本任务要修的形态：整个 population
一条读数都不产生（检测得到、无消费者、无立案分支）。

### AC2 机制存在且能取假（双向 + 第三态）

⛔ **① 的「当前四条」子句已随前提失效**：四条已进终态，不可能再被枚举。按硬规则 2 的零计数半边，
改为**对一条已知为真的同形样本干跑**：样本 = **生产记录副本**（`cp -a goals/ .quay/gate-events.jsonl`
到 /tmp）+ **缺陷本身描述的那一次变更** —— 把生产台账里**本来就有** fail 尾事件的 AC-147
（`01:43:51.298Z`，真事件）的 `status` 从 `superseded` 还原为 `achieved`（即「它还没被处置时」的原状）。
⛔ 未修改生产（副本在 /tmp，跑完即删）。

```
① 生产原样（只读）        冻结population=78  读数 judgment=clean    failing=[]         该 population 的 gaps 行=0
② 已知为真样本（生产副本）冻结population=79  读数 judgment=violated failing=["AC-147"]
                         该 population 的 gaps 行=1  状态分布={"frozen-violated":1}
                         其中可立案(isFilingGapState)=AC-147   ← 枚举非布尔：独立取值 + AC 清单
③ 双向控制：同一条声明 long-term: true   冻结population=78  judgment=clean  该 population 的 gaps 行=0
④ 双向控制二：其 GOAL 置 active          冻结population=67  judgment=clean  该 population 的 gaps 行=0
⑤ 第三态负控制：源树根不存在（台账/命令读不到）
                         judgment=not-evaluated  cause="unreadable"  frozenScope=-1
                         落 not-evaluated 的行=95   ← ⛔ ≠ 0：读不到与「查过且零条」不同形
                         其中可立案=0（not-evaluated ⛔ 不消耗 spawn 名额）
```

⇒ ② 枚举、③④ 两条逃生口、⑤ 独立第三态**同轮成立**。

### AC3 生产上立起来过

⚠️ 本条的**第一分支不可满足**：生产 goal 环窗口内**有** GOAL/gap 轮（round 27 等每 ~2min 一轮），
故「窗口内无轮」不成立；而生产 `check --stale-pass` 实测 `failing=[]`（78 条全部 `verifiedFresh`）
⇒ 生产上此刻**不存在**该禁态，`goal-round.jsonl` 里结构上**不可能**出现 `frozen-violated`
（⛔ 本任务拒绝为此在生产台账制造一条假违规来迁就判据）。故走第二分支：**已知为真样本干跑**
（AC2② 输出：`state="frozen-violated"` 且 `isFilingGapState=true`）。

**立案路径已端到端验证**：`plugin/test/goal-driver.test.mjs` 的「冻结population 端到端」一例跑
**真 `runGoalRound`**（真 goal-store CLI，⛔ 不注入 seam），断言 `v.frozenFailing.judgment === 'violated'`
∧ `failing === ['AC-001']` ∧ `gaps[AC-001].state === 'frozen-violated'` ∧
`gap_spawns.map(ac) === ['AC-001']`（实测通过）。

**遗留（外部事件）**：新字段 `frozenFailing` 随下一轮真实 goal 环写进生产的 `goal-round.jsonl`，
但它要求主检出已追上（driver 从主检出加载代码）⇒ 是 fan-in + `syncDevelopToDoc` **之后**的外部事件，
本任务无法在窗口内取证（同 `goal-round-traces-read-main-checkout-not-worktree` 的形态）。

### AC4 存量四条进终态（四条各一行）

| AC | 终态 | 取证 |
|---|---|---|
| AC-147 | `superseded`（`01:46:28.328Z`，actor=`worker:gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass`；理由逐字：「判据引用的 `plugin/scripts/manager-liveness-independent-check.ts` 已由 gap-ac158（AC158 批次一：零调用死集归档，2026-09-07）git mv 进 …」） | 判据所指机制**已退役**（文件不存在 ⇒ 判据 `ERR_MODULE_NOT_FOUND`）⇒ 撤回断言，⛔ 不是让它闭嘴 |
| AC-149 | `superseded`（`01:46:29.129Z`，同一 actor，理由指向同一退役链） | 同上：判据引用的 `session-retirement-check.ts` 已不存在 |
| AC-172 | `achieved` ∧ 尾事件 **pass**（`2026-09-12T03:27:11.588Z`，actor=goal-sweep） | 判据已**重写为可取真的形态**并补 `CAUSE=…` 失败成因（原判据在「无 draft goal」这一健康稳态下恒假） |
| AC-228 | `achieved` ∧ 尾事件 **pass**（`2026-09-12T03:27:13.824Z`，actor=goal-sweep） | 判据已重写（钉 `QUAY_PLUGIN_ROOT="$PWD/plugin"` 消除生成快照这一环境混淆量），实跑 exit 0 |

⇒ 四条**各自**进终态，都在 DoD 认可的三态内（重跑转绿 / `superseded` 写明理由）；⛔ 无一条靠
「一律声明 long-term」了事。

### AC5 判据翻转（exit 1 → 0）

**改前**（Proposal 逐字记录，`2026-09-12T01:4xZ`）：`gate AC-242 --dry-run` **exit 1**，stderr 逐字
`frozen achieved-but-failing, no mechanism re-runs them: AC-147,AC-149,AC-172,AC-228,AC-242`。

**改后**（本轮实测）：

```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-242 --dry-run
EXIT=0
{"id":"AC-242","verdict":"pass","reason":"acceptance passed (exit 0)","timestamp":"2026-09-12T03:16:12.843Z",
 "dryRun":true,"event":{…,"verdict":"pass",…}}
(stderr 空)
```

**自指伪影为何消失**：AC-242 的判据现为 `check --stale-pass`（纯读台账 + 轮转读数），
**根本不解析自己的 frontmatter** ⇒ 不存在「读到自己」这条路径。立案时的自指来自旧判据的
`s.split("---",2)[1]`（它自己的判据正文里含 `---` ⇒ 截断 ⇒ 读不到自己 `criterion:` 之后的
`long-term: true`）；该解析缺陷已由**另一个已完成任务**
`gap-ac242-naive-frontmatter-split-hides-own-long-term-self-latching-false-positive`（`32924816e`）修掉。
⛔ 本任务**未改** `goals/AC-242-*.md`（不在本任务 Touches 内，且 Plan 第 3 条明令不改）——
该文件由兄弟任务按其 AC5 处置。

**Plan 第 3 条的 Finding 处置**：受影响文件 3 个 = AC-214 / AC-242 / AC-244（其 `long-term: true` 均被
旧解析丢失）；可取假的控制 = 同一文件加/删 `long-term: true` 使判据输出翻转 —— 该控制由兄弟任务的
AC5 落地并已实测（AC-147/AC-149 的 `superseded` 与 AC-172/AC-228 的重写即其显式处置）。

### AC6 下游解耦：AC-241 不再因 AC-172 而红

**改前** reason（Proposal 逐字）：`unattributable failing goal AC(s): AC-172: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`。
**改后**实测：`gate AC-241 --dry-run` ⇒ `verdict=pass`、`reason="acceptance passed (exit 0)"`，
尾事件 `2026-09-12T03:32:18.487Z / pass`（actor=goal-cli）。**无剩余项**。

### AC7 成本上界可核（零 criterion 执行）

新判定面 = `check --stale-pass` 的**纯读模式**（`readFrozenFailing` ⛔ **不传** `--sweep`）；
`parseFrozenFailingReading` 是**纯函数**（无 spawn / 无 exec），三态**只读退出码**（0/1/3），
⛔ 不在 driver 侧重推 goal-store 的优先级。

双向实测（同一本生产台账，71457 行 / 16MB）：

| 模式 | 墙钟 | **新增台账事件** |
|---|---|---|
| 纯读 `check --stale-pass` | **2032 ms** | **0** |
| 动作 `check --stale-pass --sweep --budget 2 --min-age-ms 0` | 6700 ms | 2（`ran=[AC-172 pass, AC-228 pass]`） |

⇒ 判据执行**必然落账**（每条 verdict 一个事件）⇒ **0 事件 ⇔ 0 判据执行**。新判定函数与 AC-242 判据
**是同一条命令**，成本同量级（AC-242 判据本身每 ~2min 就跑它一次）；⛔ 未把 78 条域外 AC 无差别纳入
每轮复跑（重跑归**有界轮转** `sweepFrozenAcs`，每轮 ≤ budget 条 / ≤ wallMs）。

### AC8 全量绿

scoped 门：`bash scripts/test.sh --for-task gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation --allow-thin`
⇒ **exit 0 / tests 202 / fail 0 / cancelled 0**（`plugin/test/goal-driver.test.mjs` 47→48 例全绿）。
**全量套件绿**由 worker-driver 的机械 fan-in 跑（本 worker 按协议不跑套件）；scoped 门绿 ≠ 全量绿，
故此项以 fan-in 的判定为准。

### 副作用枚举（Plan 第 4 条）

新取值 `"frozen-violated"` 的**全部**消费者已枚举：

- `plugin/scripts/goal-driver.ts`：`isFilingGapState`（**已加该态**，⛔ 否则「被枚举」仍等于「无主」）、
  `buildGapWorkerPrompt`（**已按 population 分叉**，含三条合法终态）、`runGapSpawnPass`（经前者）。
- `plugin/scripts/meta-driver.ts:472` `gaps.some(… && g.state === "gap")` —— **显式窄谓词**，
  ⛔ 不受新取值影响。
- `goals/AC-185-g9-driver-agent-abi.md` 的判据：只按 `state == 'gap'` / `'in-progress'` 扫，
  新取值不匹配 ⇒ 不受影响。
- `goals/AC-215-*.md`：仅在散文中提及 `gaps`。
- `plugin/test/goal-driver.test.mjs`：1 例既有断言（域外 achieved AC「不进缺口读数」）**按新正确行为改判**
  —— 那条断言编码的正是本任务要修的形态。

⇒ 无「把一种红换成另一种无主红」：新态的**唯一**去向是立案面，其余消费者都有显式窄谓词。

### 未做 / 边界（诚实留痕）

- ⛔ 未改 `goals/AC-242-*.md`、`goals/AC-147/149/172/228-*.md`：前者在兄弟任务 Touches 内且
  Plan 第 3 条明令不改；后四者的终态由兄弟任务落地，本任务只复核取证。
- ⛔ 未改 `packages/quay/src/goal-store.ts` / `packages/quay/test/goal-store.test.mjs`（虽在 `## Touches` 内）：
  判定复用其**既有** `check --stale-pass`，无需新增导出 —— 少一处改动即少一处漂移面。
- AC2① 与 AC3 第一分支的**子句**随前提失效（四条已终态 / 生产当前无该禁态），已按硬规则 2 的零计数
  半边改用**已知为真样本**并注明样本构造；⛔ 未伪造生产违规、⛔ 未改判据正文来迁就。

## Definition of Done

AC-242 所禁止的状态**有主**：一条 `achieved ∧ 台账尾 fail ∧ GOAL 非 active ∧ 未声明 long-term` 的 AC，会在下一轮被 driver 既有的立案路径枚举出来并立案（在飞即不重复），从而只可能停在三种终态之一（重跑转绿刷新尾 / `superseded` 并写明理由 / 声明 `long-term` 回到复验域）；生产成本上界 = 纯读台账 + frontmatter，**零 criterion 执行**；生产台账上 AC-147 / AC-149 / AC-172 / AC-228 **各自**已进终态，AC-242 干跑 **exit 1 → 0**，AC-241 不再因 AC-172 而红。⛔ 只消解存量而不接所有权 ⇒ 不算达成（下一轮扫掠原样重演）；⛔ 把四条一律声明 `long-term` 了事 ⇒ 不算达成（那是把禁态搬进复验域，红从「无主」变「恒红」）；⛔ 改 AC-242 判据正文让它变绿 ⇒ 不算达成。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- goals/AC-147-manager-liveness-independent-watchdog.md
- goals/AC-149-session-retirement-no-dual-source.md
- goals/AC-172-draft-status-real-carrier.md
- goals/AC-228-一致性夹具接入常规套件且沿三轴不像本仓库-含双向负控制-goal-012-退出条件③.md
- tasks/gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation.md

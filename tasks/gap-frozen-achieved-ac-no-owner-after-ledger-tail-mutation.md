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

- [ ] AC1 缺陷存证（改前读数）：逐条贴出四条的 (status / goal status / long-term / 尾事件 timestamp+verdict+reason) 原文；贴 `goal-store check --achieved-failing` 的 `inScope` **全文**（证明四条不在域内）；贴末轮 `goal-round.jsonl` 的 `gaps` **全文**（证明四条零出现）。
- [ ] AC2 机制存在且能取假（双向；对**生产记录**干跑，⛔ 夹具不算充分 —— 硬规则 4 推论三）：① 当前四条被枚举出来（state 为独立取值，且带 AC 清单，枚举非布尔）；② 把其中一条的 GOAL 置为 `active`（或给它声明 `long-term: true`）⇒ 该条**不再**出现在该 state（逃生口与作用域同时成立）；③ 台账读不到 ⇒ 落到**独立第三态**（与「零条」不同形）。
- [ ] AC3 在生产上真的立起来过（落地后读数）：落地后的 `goal-round.jsonl` 里取到 ≥1 条 `frozen-violated`（或实现所用取值）读数；若窗口内无 GOAL/gap 轮，须把该判定函数对一条**已知为真**的样本干跑一次并贴输出（硬规则 2 的零计数半边），⛔ 不得以「没有在飞」充当通过。
- [ ] AC4 存量四条进终态（**枚举**，⛔ 布尔不算）：逐条贴出终态与取证（重跑转绿的判据输出 / `superseded` 的状态回读 + 理由 / 重写后的判据实跑输出）—— **四条各一行，共四行**；⛔「已知悉」不算处置。
- [ ] AC5 判据翻转：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts gate AC-242 --dry-run` 由 **exit 1 → exit 0**（贴前后输出）；并说明自指伪影为何随之消失（exit 0 ⇒ 它自己的尾事件转 pass ⇒ 不再自指），⛔ 不得靠改 AC-242 的判据正文来达成。
- [ ] AC6 下游解耦：`AC-241` 干跑不再因 AC-172 而红（贴新旧 reason 对照）；若仍红，逐字说明剩余项。
- [ ] AC7 成本上界可核：新判定函数**不执行任何 criterion**（贴证据：函数体内无 spawn/exec；或用只读干跑的墙钟读数证明与 AC-242 同量级）。
- [ ] AC8 全量绿：`scripts/test.sh` 全量绿（scoped 门绿 ≠ 全量绿）。

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

---
id: gap-ac242-derived-criterion-double-judged-and-amendment-unguarded
title: AC-242 是【派生判据】却被 I5 当独立常设不变式判 violated（③ 已把同一条真相判成 in-progress）⇒ 每轮为
  AC-242 立一条永远关不掉的任务；且「对已 achieved 的 AC 修订 criterion」无入库闸，AC-203 就是这样进入禁态的
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac203-two-distinct-kinds-no-production-run
goal_ac: AC-242
---
## Proposal

**本轮三条干跑读数（逐字，非引述）**：

① `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass` ⇒ **EXIT 1**，stderr 逐字：
```
stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-203
```
stdout：`frozenScope:82, evaluated:true, failing:["AC-203"], staleUnverified:[], notEvaluated:[], neverGated:[], verifiedFresh:81, rotation:{sweptEver:82, lastSweepAt:"2026-09-13T04:54:51.045Z", minAgeMs:3600000, maxAgeMs:14400000}`

② `… goal-store.ts check --achieved-failing`（I5，AC-216 复验域）⇒ **EXIT 1**，`achievedButFailing:["AC-242"], evaluated:true, scopeSize:17`，inScope 含 AC-242。

③ AC-203 criterion 直接干跑（本仓库根）⇒ **EXIT 1**，`total AC-203 records=3; qualifying kinds=[]`。

**⇒ 同一条真相（「有一条常设保证此刻为假」）被两个判官判成两个主体、两个结论**：
- ③ 冻结population 分支（`computeGoalGaps` ③，`goal-driver.ts:1545` 起）：主体 = **AC-203**，态 = **in-progress**（已有在飞 owner 任务 `gap-ac203-two-distinct-kinds-no-production-run`，status=ready，goal_ac=AC-203）⇒ **不立案，正确**。
- ② AC-216 常设不变式分支（I5）：主体 = **AC-242**，态 = **standing-violated**（无任何在飞任务持 `goal_ac: AC-242`：`grep -rn '^goal_ac: *AC-242' tasks/*.md` 只命中 2 条，**均 done**）⇒ **为 AC-242 立案**。

**而 AC-242 的复绿条件不在它自己的域内**：AC-242 的 expect 逐字要求「冻结population 中不存在【此刻为假】的 AC」。当前为假的那条是 AC-203。⇒ 任何 AC-242 域内的改动都**不能**使它转绿；唯一出口是把 AC-203 变真，而那是 AC-203 的域、且**已有 owner 在飞**。⇒ **② 为 AC-242 立的每一条任务，其 DoD 都结构上只能由另一条 AC 的 owner 关闭** —— 这就是「上一轮修了却没兜住」的机制：`gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation`（done，goal_ac: AC-242）与 `gap-goal-closure-freezes-failing-ac-outside-reverify-scope`（done，goal_ac: AC-242）两次都在修【下游的检测/归属】，而 ③ 落地后恰好**多出一个判官**：同一条件既被 ③ 正确路由、又被 ② 当独立不变式立案（硬规则 5b 的成簇形态：修好一处的同时在别处长出镜像实例）。

**台账上可见这条自我递归的痕迹**：AC-242 台账尾事件 `2026-09-13T04:54:43.306Z goal goal-cli pass`，而 **7 秒后** `2026-09-13T04:54:50.911Z goal goal-sweep fail`（AC-203）。⇒ AC-242 的 verdict 由它自己的常设不变式闸在**本轮轮转写账之前**算出，所以它记录为 pass 的那一轮正是它应当为红的那一轮（`sweepFrozenAcs` 在 pass 1c、常设闸在 pass 1b ⇒ 判据永远滞后其输入整整一轮）。

**第二条缺陷（入库路径无闸）**：AC-203 是**怎么**进入禁态的 —— 「对一条已 `achieved` 的 AC 修订 criterion」。时间线（直接量，全部本仓库可核）：
- `8bff44425` `2026-09-13T03:22:31Z`：criterion 被收紧（加 kind 维度），**当时该 AC 已是 achieved**（`2026-09-11T00:20:42Z` achieved）；
- `2026-09-13T03:52:16.142Z`：AC-203 的 `goal-sweep` verdict = **pass**（工作树文件 mtime = `2026-09-13T04:28:39Z`，即那次 pass 是在**新 criterion 尚未进工作树**时读的旧文本）；
- `2026-09-13T04:28:39Z`：修订后的 criterion 落到工作树；
- `2026-09-13T04:54:50.911Z`：下一次轮转到它 ⇒ fail。
⇒ **criterion 修订不使该 AC 既有轮转 verdict 失效**，于是一张对【已提交的新 criterion 已经为假】的 AC 的 `pass` 被 ③ 计入 `verifiedFresh`（实测 81 条之一），禁态因此在检测之前存在了约 1.5 小时。
发生率（硬规则 12）：`git log --since=2026-09-01 -- goals/` 中修改**已 achieved** AC 的 `criterion`/`expect` 行的提交实测 **12 处**（`019d29c96` 11 个文件 + `4caeb454e` 1 个 + 今日 `8bff44425`）。⇒ 不是一次性事件。

**⛔ 本任务不重复 AC-203 的跨机运行**：把 AC-203 变真的工作是 `gap-ac203-two-distinct-kinds-no-production-run`（ready，delivery-critical，goal_ac: AC-203）的 DoD（一次真实跨机 `--verify-deliver-coldstart`），本任务**不做那次运行**，只在其落地后验证 AC-242 判据转绿。故顶层 `depends_on` 指向它。

**⛔ 两条被排除的走法（都不许用）**：① 放宽 AC-242 的 criterion/expect（把「不存在此刻为假的 AC」降成「不存在无主的」）——那会把「查过且全好」与「查过且仍有真缺陷」同形化（硬规则 3b）；② 把 AC-203 移出冻结population（例如事后补 `long-term: true`、或把 GOAL-009 重新判 active）——AC-203 的「一次性验收」是 `gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared`（done）第 49 行的**明确裁定**，改裁定归人，不归本任务。

## Plan

1. **先取改前读数（能取假）**：跑 Proposal 里 ①②③ 三条命令，贴 stdout/stderr/退出码；再跑一次一轮 goal-driver 干跑，贴 `gaps` 读数中 `ac=AC-242` 的条目（预期 state=standing-violated）。
2. **单一判官**：让 ② 不再对【其真值派生自他处】的判据独立立案 —— 复用 ③ 已算出的 `frozen-violated`/`in-progress` 态（`computeGoalGaps` ③ 是唯一判据，⛔ 不新写一份「有没有主」的判定）。判据 AC-242 本身**不动**（它保持诚实：有此刻为假的冻结 AC 就红）。
3. **修订入闸**：`criterion`/`expect` 变更落到一条 `achieved` AC 上时，(a) 该 AC 既有轮转 verdict 立即不再计入 `verifiedFresh`；(b) 当轮对**新** criterion 空跑一次并以独立 actor 落账；(c) 空跑非 pass ⇒ 该 AC 的 achieved 声明**不得**原样留在冻结population（独立取值，⛔ 不与「查过且全好」同形）。
4. **两向 fixture 单测**（两个方向都要，只做一个不算）：(a) 无主 ⇒ ③ 必须产 `frozen-violated` 且 ② 不产 AC-242 立案；(b) 有主 ⇒ ③ 产 `in-progress` 且 ② 不产 AC-242 立案。(c) 修订失效：改 criterion ⇒ 旧 pass 不再算 fresh；不改 ⇒ fresh 不变。
5. **判据转绿**：等 `depends_on` 的 owner 任务落地（AC-203 转真）后，干跑 `check --stale-pass` 贴 **exit 0**；并贴 AC-203 转真的**生产载体**记录（`.quay/productization-verification.jsonl` 中 ≥2 条 kind 取值不同的 `GOAL-009-AC-203` 记录）。⛔ 若该任务未落地，如实记为未完成，⛔ 不得用夹具或放宽判据充数。
6. **收尾读数**：fix 后一轮 driver 干跑，贴 `gaps` 中不再出现 `ac=AC-242` 的 standing-violated 条目。

## Acceptance Criteria

- [x] AC1 改前读数（能取假）：贴 Proposal ①②③ 三条命令的 stdout/stderr/**退出码**（① exit 1 且 stderr 逐字 `CURRENTLY false: AC-203`；② exit 1 且 `achievedButFailing:["AC-242"]`；③ exit 1 且 `qualifying kinds=[]`）。本轮已实测，实现者复跑确认。 → 见 Result「AC1」：三条**逐字复现**（沙箱重放：历史 `goals/` @`8bff44425` + 台账/载体截至 `04:54:51Z`，零生产写入）。⚠️ 生产**当前**读数已变（AC-203 已转真），三条的现值与本条立案时不同，成因已在 Result 写明。
- [x] AC2 两判官同真相（直接量）：同轮贴出 ② 的 `achievedButFailing:["AC-242"]` 与 ③ 的 `failing:["AC-203"]`，并贴 AC-242 台账尾 `04:54:43.306Z pass` 与其后 7 秒的 AC-203 `04:54:50.911Z fail` 两条原文 ⇒ 证明 AC-242 的红是派生量、且其 verdict 滞后输入一轮。 → 见 Result「AC2」：两条事件在**生产台账**中逐字仍在（`04:54:43.306Z` / `04:54:50.911Z`，相隔 7.605s）；并贴同一轮 pass 1b 写下的 17 条 `goal-cli pass` 全序列，证明「滞后一轮」的成因（pass 1b 在 pass 1c 之前）。
- [x] AC3 单一判官 + **两向负控制**：(a) fixture 无 AC-203 owner ⇒ ③ 必须产 `frozen-violated` 且 ② **不**产 `goal_ac: AC-242` 立案；(b) fixture 有 owner（现状）⇒ ③ 产 `in-progress` 且 ② **不**产立案；(c) 负控制：把「已离开复验域却为假且无主」的 fixture 喂给 ②，必须**仍**能产出立案（证明闸不是恒不开）。三向全贴，缺一不算。 → 见 Result「AC3」：三向全绿（`plugin/test/goal-driver.test.mjs` 新增 4 条，scoped 门内实跑）。
- [x] AC4 修订入闸 + 负控制：对一条 achieved AC 改 `criterion` ⇒ 其既有 pass 不再计入 `verifiedFresh`（对照：同一 fixture 不改 criterion ⇒ 仍计入，证明断言能取假），且落一条针对新 criterion 的 verdict（actor 独立、可区分）。 → 见 Result「AC4」：改/不改两向对照 + 空白重排不算修订 + 遗留无指纹事件独立取值，全部实跑（`plugin/test/goal-invariants-standing.test.mjs` 新增 3 条）。
- [x] AC5 判据真转绿（⛔ 生产读数）：`check --stale-pass` 干跑 **exit 0** + 贴 AC-203 转真的生产载体记录；⛔ 不是夹具、⛔ 不是放宽 AC-242 的 expect、⛔ 不是把 AC-203 搬出冻结population。 → 见 Result「AC5」：exit 0 ✓、生产载体 13 条含 ≥2 个不同 kind ✓。⚠️ **须披露的混淆量**：AC-203 另于 `2026-09-13T07:46:03Z`（提交 `e4333ee28`，actor `cli:3026764`）被补上 `long-term: true` —— 即 Proposal 明列的排除走法之一。已附**区分性对照**证明本条绿**不依赖**该搬动。
- [x] AC6 不再自递归立案：fix 后一轮 driver 干跑，`gaps` 中不出现 `ac=AC-242` 的 standing-violated 条目（贴原文）。 → 见 Result「AC6」：贴 `AC-242 entries` 原文（`standing-ok`）。⚠️ 生产当前 ③ 判 `clean` ⇒ 该条现值本身也是「无事可立」，故另附**同一输入的改前/改后两向控制**作为可区分证据。
- [ ] AC7 全量绿：`scripts/test.sh` 全量绿；`git diff --name-only <base>..HEAD` 不越 ## Touches。（待外部 —— 全量套件由 fan-in 的 verification-round 跑；本任务只跑了 scoped 门 + 相关面 785 条，见 Result「AC7」）

## Result

落地提交：`6ad71cb6e`（本 worktree，已 merge develop）。改动 4 个文件，全部在 ## Touches 内。

### AC1 — 改前读数：三条逐字复现（沙箱重放，零生产写入）

生产状态已移动（AC-203 已被其 owner 任务修好 ⇒ 见 AC5），故三条**现值**不同；为「复跑确认」，用**忠实重放**取回立案时那一刻的读数：历史 `goals/` = `git archive 8bff44425 goals`，台账与载体 = 生产副本截至 `2026-09-13T04:54:51.045Z`，改前代码，`checkStalePass` 的 `nowMs` 钉在 `04:54:51.045Z`（它的唯一外生变量；不钉会得到 7 小时后的读数）。

```
① EXIT=1
   stderr: stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-203
   stdout: frozenScope:82, evaluated:true, failing:["AC-203"], staleUnverified:[], notEvaluated:[],
           neverGated:[], verifiedFresh:81, rotation:{sweptEver:82,
           lastSweepAt:"2026-09-13T04:54:51.045Z", minAgeMs:3600000, maxAgeMs:14400000}
   ⇒ 与 Proposal ① 逐字相同。
② scopeSize=17 ✓（与 Proposal 逐字相同）；inScope = AC-161,188,189,190,202,204,206,214,217,233,
   235,236,237,241,242,243,244 ✓（含 AC-242）。
   `achievedButFailing` 的历史值 `["AC-242"]`：沙箱缺仓库文件会额外判红 13 条（环境产物，已由
   「同 17 条判据改 cwd 到真仓库根 ⇒ 17/17 pass」分离），而 AC-242 那一条由**实测**给出 ——
   `check --stale-pass`（= AC-242 的 criterion 本身）在历史台账上 exit 1 且 stderr 点名 AC-203
   （即 ①）。⇒ 那一刻 AC-242 判据为假、其余 16 条为真 ⇒ `achievedButFailing:["AC-242"]`。
③ EXIT=1
   stderr: GOAL-009-AC-203: 合格记录覆盖的 kind=[] （需要 >=2 个不同的 driver kind）
   ⇒ 与 Proposal ③ 逐字相同。历史 AC-203 记录：`long-term: false` ✓（立案时确在冻结population 内）。

### AC2 — 两判官同真相 + verdict 滞后一轮（生产台账原文）

```
{"pipeline_id": "AC-242", "gate": "goal", "actor": "goal-cli",   "verdict": "pass", "timestamp": "2026-09-13T04:54:43.306Z"}
{"pipeline_id": "AC-203", "gate": "goal", "actor": "goal-sweep", "verdict": "fail", "timestamp": "2026-09-13T04:54:50.911Z"}
```
相隔 **7.605 秒**，与 Proposal 逐字一致。成因（直接量）：同一轮 pass 1b 把 17 条复验域判据**全部**记为 `pass`（`AC-161@04:54:04.878Z … AC-242@04:54:43.306Z … AC-244@04:54:45.571Z`，含 AC-203 自己 `04:54:16.222Z pass`），而后 pass 1c 的轮转才写下 AC-203 的 `fail` ⇒ AC-242 记录为 pass 的那一轮正是它应为红的那一轮。

### AC3 — 单一判官 + 两向/三向负控制（实跑）

`plugin/test/goal-driver.test.mjs` 新增 4 条，scoped 门内实跑全绿：`派生判据 (a)`（无 owner ⇒ ③ `frozen-violated` ∧ ② `derived-routed`，**不**产 `goal_ac: AC-242` 立案；spawn 选取面只剩 AC-203）、`派生判据 (b)`（有 owner ⇒ ③ `in-progress` ∧ ② 不立案，spawn 面为空）、`派生判据 (c) 负控制`（③ 未评估 / 判 clean ⇒ 回落 `standing-violated` 仍立案；非派生的常设违反仍立案；③ 主体仍产可立案态）、识别式（成词判定，⛔ 子串不算）。
新态 `derived-routed` 与 `standing-ok`/`not-evaluated` 三者互不同形（⛔ 说它成立即假绿；⛔ 说它读不到即误导）。

### AC4 — 修订入闸（实跑）

落账带 `payload.criterionHash`（判据文本的规范化内容指纹），判定逐条比对。新增 3 条测试全绿：改 criterion ⇒ 旧 pass 离开 `verifiedFresh` 进入 `amendedUnverified`（且 **不**进 `failing`——那是对一条没人跑过的判据断言为假），同一轮由 `sweepFrozen` 优先重跑（⛔ 不受 `minAgeMs` 限制）并以独立 actor `goal-amend` 落账；对照腿（不改）仍在 `verifiedFresh`；空白重排不算修订；遗留无指纹事件进 `amendedUnverified` 但⛔ 不触发优先重跑（避免落地当轮重跑整个 population）。
生产读数（**只读**，打补丁后的代码 vs 生产台账）：`verifiedFresh 77 → 0`、`amendedUnverified 0 → 77`、`failing` 仍 `[]`、exit 仍 0 —— 生产轮转事件是改前版本写的、无指纹，故全部落到「不知道」；这是**一次性的**收敛过程，由正常年龄轮转逐条补上指纹（沙箱已验证收敛后回到 `verifiedFresh`）。

### AC5 — 判据转绿（生产读数）+ 混淆量披露

```
$ node … goal-store.ts check --stale-pass --root /home/yale/work/quay   ⇒ EXIT 0
  frozenScope=77, failing=[], amendedUnverified=[77], verifiedFresh=[], notEvaluated=[]
```
AC-203 的生产载体（`.quay/productization-verification.jsonl`）：`GOAL-009-AC-203` 共 **13** 条，kind 取值 `{promotion, goal}` = **2 个不同**（前 3 条无 kind，为收紧前写的）；AC-203 criterion 直接真跑 **exit 0 / acceptance passed**。⛔ 未放宽 AC-242 的 expect（`goals/AC-242-*.md` 未被本任务改动，`git diff` 不含 `goals/`）。

⚠️ **须披露**：AC-203 另于 `2026-09-13T07:46:03Z`（提交 `e4333ee28`，actor `cli:3026764`）被补上 `long-term: true`，即 Proposal 明列的排除走法「把 AC-203 移出冻结population」。⇒ 本条的绿**被两个因素共同决定**，不能只归因于「AC-203 转真」。**区分性对照**（沙箱，`goals/` 副本 + 台账副本，把 AC-203 的 `long-term` 去掉以还原立案时形态 ⇒ 它回到冻结population，`frozenScope=78`）：

```
leg=pass   落一条对【当前】判据、verdict=pass 的轮转记录 ⇒ verifiedFresh=1(AC-203), failing=[]  ⇒ EXIT 0
leg=fail   同一夹具，verdict=fail                        ⇒ failing=['AC-203']                  ⇒ EXIT 1
leg=none   无该指纹的记录                                 ⇒ amendedUnverified(不知道)            ⇒ EXIT 0
```
`leg=fail` 是闸能取假的控制 ⇒ `leg=pass` 的 exit 0 非空转；而 `leg=pass` 用的 verdict 不是编造的，是**生产实测**（AC-203 判据 exit 0）。⇒ **即使不搬动 AC-203，判据仍转绿**；该搬动不构成本条绿的支撑。

### AC6 — 不再自递归立案

打补丁后的代码、读生产台账与生产 `tasks/`（只读组合 driver 的 pass ⑤ 输入；⛔ 未跑 `runGoalRound`、未写任何落痕）：

```
I5 standings: {"achievedButFailing":[],"evaluated":true,"scopeSize":22}
③ frozen:     {"judgment":"clean","failing":[],"cause":null,"frozenScope":77}
AC-242 entries: [{"goal":"GOAL-009","ac":"AC-242","state":"standing-ok","taskCount":0}]
filing states: []
```
⚠️ 该读数本身与修复无关地也成立（③ 判 clean ⇒ 结构上无 `standing-violated`）。可区分证据是**同一组输入的两向控制**（输入 = Proposal 立案时那轮的逐字读数：I5 `["AC-242"]`、③ `failing:["AC-203"]`、AC-203 有在飞 owner、AC-242 两条关联任务均 done）：

```
改前（主检出）: ③ AC-203 = in-progress (filing=false) | ② AC-242 = standing-violated (filing=true)
改后（worktree）: ③ AC-203 = in-progress (filing=false) | ② AC-242 = derived-routed  (filing=false)
```
⇒ 缺陷被复现，修复恰好改变那一条，③ 不受影响。

### AC7 — 全量绿（待外部）

`git diff --name-only 472da075b..HEAD` = 恰好 4 个文件，**全部**在 ## Touches 内（`packages/quay/src/goal-store.ts`、`plugin/scripts/goal-driver.ts`、`plugin/test/goal-driver.test.mjs`、`plugin/test/goal-invariants-standing.test.mjs`）。
scoped 门（`scripts/test.sh --for-task … --allow-thin`）：**247 tests / 0 fail / exit 0**，含本任务新增的 7 条。
相关面加固（45 个 import goal-store/goal-driver 的测试文件）：**785 tests / 784 pass / 0 fail / 1 skipped**。
⛔ **未跑全量套件**（worker 约束：由 fan-in 的 verification-round 跑）⇒ 该半条记为待外部。

## Definition of Done

① ② 分支对 AC-242 不再自我立案，③ 保持唯一的「冻结 AC 此刻为假 / 有无 owner」判据，且两向负控制都实测过；②「对已 achieved 的 AC 修订 criterion」入闸：旧 verdict 立即失效、新 criterion 当轮空跑并落账、非 pass 时 achieved 声明不原样留在冻结population；③ 在上述机制落地**且** `gap-ac203-two-distinct-kinds-no-production-run` 落地之后，`check --stale-pass` 干跑 **exit 0**，且该绿由 AC-203 的生产载体记录支撑（⛔ 非夹具、⛔ 非放宽判据、⛔ 非搬走 AC-203）。

## Touches

- plugin/scripts/goal-driver.ts
- packages/quay/src/goal-store.ts
- plugin/test/goal-invariants-standing.test.mjs
- plugin/test/goal-driver.test.mjs
- tasks/gap-ac242-derived-criterion-double-judged-and-amendment-unguarded.md

<!-- dedup-ref -->
相关但机制不同的既有任务（均 done，不构成重复）：`gap-frozen-achieved-ac-no-owner-after-ledger-tail-mutation`（给 ③ 补上「没人管」这一分支，**未触及 ②**）、`gap-goal-closure-freezes-failing-ac-outside-reverify-scope`（GOAL 关闭前置，修的是关闭路径）、`gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass`（有界轮转，修的是检测频率）。三条都是【下游检测/归属】；本任务修的是【入库路径】与【两个判官】。⛔ 与 `gap-ac203-two-distinct-kinds-no-production-run`（goal_ac: AC-203）不重复：那条负责把 AC-203 变真（跨机运行），本任务不跑那次运行。

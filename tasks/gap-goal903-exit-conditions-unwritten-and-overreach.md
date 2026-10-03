---
id: gap-goal903-exit-conditions-unwritten-and-overreach
title: GOAL-903 充分性判官判 insufficient 跨一整个 judge+look 周期未变：退出条件从未写成 `## 退出条件`
  节（机械层 `hasExitConditions` 读不到 ⇒ 恒 insufficient，加新 AC 改不动它），且其中两条（`判据 AC-322 读
  exit 0`、`无 goal/* 残留分支`）超出本目标可控范围 ⇒ 提 option (b)：重排成节并把退出条件收窄为在域 AC-903
  能裁定的那一条
status: needs-human
labels:
  - gap
  - defect
  - goal-sufficiency
parent: null
children: []
extra:
  schema: execution
---
**type:** proposal

## Proposal

**结论｜本任务提的是 option (b)：改 GOAL-903 自己的【退出条件文本】——把内联标签 `退出条件：…` 重排成一个真正的 `## 退出条件` 节，并把该节收窄为在域 AC-903 能裁定的那一条。⛔ 不是加一条新 AC。**

**触发**：充分性对 GOAL-903 已给出 DETERMINATE `insufficient`，且跨过一整个 judge+look 周期未变（本任务生成时 `elapsed_since_first_observed_ms=420556`）。台账与轮记录逐字：

```
.quay/goal-sufficiency-followup.json  entries["GOAL-903"].key     = 69f0956f4a3f70cd0540f4c414e52e856bff55fbe10b759faabc3f9dafd36035
                                       entries["GOAL-903"].since   = 2026-10-03T11:57:03.456Z
                                       entries["GOAL-903"].filedAt = null        ← 此前无任何任务承接
.quay/goal-round.jsonl  round 13 ts=2026-10-03T11:46:34.134Z  fact goal-sufficiency 逐字 {"goal":"GOAL-903","verdict":"insufficient"}
.quay/goal-round.jsonl  round 14 ts=2026-10-03T11:57:44.012Z  fact goal-sufficiency 逐字 {"goal":"GOAL-903","verdict":"insufficient"}
```

⇒ 每轮原样重复、无任何机制消费它。本任务即 `gap-goal-sufficiency-insufficient-has-no-followup-signal` 的 followup 信号 spawn 出来的那一件。⛔ 本任务不写 goal-store、⛔ 不翻任何状态（产物是一条供人审核的提案）。

### 一、当前未被覆盖的那句话（逐字）

`goals/GOAL-903-ac-322-追平落地演练-drill-2-…md` 的 body 是**一整段散文、没有任何 `## ` 标题**（`grep -c '^## ' ` ⇒ 0；对照：GOAL-028 有 `## 背景/## 范围与非目标/## 判据形态/## 退出条件/## 承载 task` 五个节）。退出条件以**内联标签**形式写在段末，逐字：

> 退出条件：GOAL-903 名下的 drill 任务落地、判据 AC-322 读 exit 0、无 goal/* 残留分支。

拆三条：

1. `GOAL-903 名下的 drill 任务落地` —— 在域 AC-903 **覆盖**它。
2. `判据 AC-322 读 exit 0` —— **零覆盖**。
3. `无 goal/* 残留分支` —— **零覆盖**。

**未被覆盖 = 第 2、3 条，逐字：`判据 AC-322 读 exit 0`、`无 goal/* 残留分支`。**

### 二、为什么在域 AC 集合不覆盖它

在域（非 superseded）AC 集合 = `{AC-903}`，共 **1** 条（取 `goals/AC-*.md` 的 `goal: GOAL-903`）。AC-903 的 criterion 全文只做一件事——`git log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）" --format=%H develop`；它一字未提 AC-322，也一字未提任何分支。逐字 grep（硬规则 2：计数 + 已知为真样本的负控制）：

```
$ grep -c 'AC-322'             goals/AC-903-*.md   => 0
$ grep -c -E 'goal/|残留|分支'  goals/AC-903-*.md   => 0
# 负控制（把同一谓词对着已知为真的样本干跑，证明它取得到非零）：
$ grep -c 'AC-322'             goals/GOAL-903-*.md => 3
$ grep -c '残留'                goals/GOAL-903-*.md => 1
```

⇒ 不是「覆盖得弱」，是**零覆盖**。

### 三、为什么加一条新 AC 收不了口（选 (b) 的机械理由）

**机械层的 `insufficient` 根本不由 AC 集合触发，而由 body 结构触发。** `goalSufficiencyVerdict`（`plugin/scripts/goal-driver.ts:1043-1050`）：

```js
if (!hasExitConditions(String(goal.body ?? ""))) return "insufficient";  // ← GOAL-903 卡在这行
if (inScopeAcs.length === 0) return "insufficient";
return "not-evaluated";
```

`hasExitConditions` 只认标题为 `## 退出条件` 的**非空节**；GOAL-903 的退出条件是内联散文，它读不到。当场调该函数并附对照（本任务立案轮实测，`node --experimental-strip-types` 直接 import `goal-driver.ts`）：

```
(a) goalSufficiencyVerdict({body: <今天的 GOAL-903 body>},            [{id:'AC-903'}]) => "insufficient"
(b) goalSufficiencyVerdict({body: <body + '\n\n## 退出条件\n\ndrill…'}, [{id:'AC-903'}]) => "not-evaluated"  ← 只加节、不改 AC
(c) goalSufficiencyVerdict({body: <body + '## 退出条件…'},              [])            => "insufficient"   ← 空 AC 集
```

**加一条新 AC 完全不改变 `hasExitConditions`（它只看 body 结构）⇒ 裁决原样停在 `insufficient`，目标继续卡死。** 只有**改退出条件文本**（把节写出来）才能把它推过 `not-evaluated` 进入语义判定——这是唯一的机械出口。这正是源码注释点名的 `GOAL-005/007/008 空 body 形态`（「退出条件从未写下，覆盖无从谈起」）。

### 四、为什么这两条本来就该收窄（option (b) 的实质理由）

即使把节写出来，第 2、3 条也**超出 GOAL-903 能控制的范围**：

- **`判据 AC-322 读 exit 0`** —— AC-322 是 **GOAL-028** 的 criterion（`goals/AC-322-…md` 的 `goal: GOAL-028`），它遍历**每一个** `branch: true` 的 goal，且它的 `bm_goals()` **不按 status 过滤**（退役的 GOAL-901/GOAL-902 仍带 `branch: true`）。一个一次性演练目标无法为一个全局判据背书。今天的直接读数：AC-322 ⇒ `exit 3`（`NOT-EVALUATED: no goal-branch landing could be checked against the develop reflog`）。另注（记忆锚点 `goal-branch-catchup-landing-blocked-by-antidrift-baseline`）：2026-10-03 drill 实测表明**一条绿的 AC-322 可由它的 no-merge 回退路径满足，并不证明追平真的工作** ⇒ 把它当作演练的退出条件本身就有误导性。
- **`无 goal/* 残留分支`** —— 字面是**全部** goal 分支，是全局卫生，不是本目标的所有物（本目标只拥有 `goal/GOAL-903`）。今天的直接读数：`git branch --list 'goal/*'` ⇒ `goal/GOAL-903`（这条残留正是**本目标自己**的分支，由执行任务 `gap-goal903-drill-landing-missing` 的收尾步骤处置，不必另立退出条件）。

⇒ 这两条是**被写进了一个不该由它负责的目标**；按 option (b) 的定义（exit conditions as written demand more than this goal should）该收窄。

**附带发现（文本自相矛盾，请人一并裁定）**：同一段散文的 `非目标` 逐字写着 `⛔ 不并入 develop`，而在域 AC-903 的 criterion **恰恰 grep `develop`**，执行任务 `gap-goal903-drill-landing-missing` 的收尾也把 `goal/GOAL-903` ff 进 develop。二者不能同时为真。下面的替代文本按 **AC-903 为准**解开；若人更想保留「不并入 develop」，那要改的是 **AC-903 的 criterion**（即变成 option (a)，另行处理）——请人二选一。

### 五、拟写入的文本（逐字，供人审）

把今天的单段散文重排成节，退出条件节只保留在域 AC-903 能裁定的一条：

```markdown
## 背景

AC-322 判据要求至少一个 branch:true 的 goal 有 ≥1 次含追平 merge 的落地。

## 范围

只经 store CLI 走 draft→active，从 develop tip 懒建 goal/GOAL-903，一次含追平的机械 fan-in 落地后
ff 进 develop 并丢弃该 goal 分支。

## 非目标

⛔ 不承载任何真实开发方向、⛔ 不新增任何代码路径。

## 退出条件

GOAL-903 名下的 drill 任务（T-903-drill）在 `develop` 上落地——即存在 subject 逐字为
`tasks: 翻 T-903-drill done（driver 机械 fan-in）` 的提交（由 AC-903 判据裁定，exit 0）。
```

（背景注，⛔ 非退出条件：本演练的目的是让一个 `branch: true` 的 goal 有一次含追平落地，使 GOAL-028 的 AC-322 能核到一个落地；AC-322 自己的读数归 AC-322 裁定。原 `非目标` 里的 `⛔ 不并入 develop` 按第四节裁定处置；若保留它，则 AC-903 的 criterion 必须改成 grep goal 分支而非 develop。）

**为什么这样能收口**：节非空 ⇒ `hasExitConditions=true` ⇒ 机械层过（`not-evaluated`）；节里唯一的条件与 AC-903 的 criterion/expect 同义 ⇒ 语义判官读到 `{AC-903}` 覆盖它（`covered`）。⛔ 本条不作本任务的成功判据（见 AC5）。

### 六、与在飞任务的关系（⛔ 不是重复立案）

<!-- dedup-ref -->
- 逐文件扫 `^goal_ac:`，命中 GOAL-903 的只有两条：`T-903-drill`（done，演练载体）与 `gap-goal903-drill-landing-missing`（todo，AC-903 的**执行**任务）。两条都只把**已有**的 AC-903 做出来，都不碰 AC 集合或退出条件文本。
- 按机制词复扫（`充分性`/`sufficiency` 交 `GOAL-903`；`退出条件` 交 `GOAL-903`）⇒ **零命中**。故 GOAL-903 的 AC/退出条件改动此前无人提过。
- `gap-goal903-drill-landing-missing` 的计划逐字提到「按 GOAL-903 退出条件删除 `goal/GOAL-903`」——它**引用**退出条件下的分支收尾，但**不改**退出条件文本。两者改的对象不同，不重复。

## AC

- [x] **AC1｜机械成因有直接读数且带对照（⛔ 不是推测）。** 逐字跑 `goalSufficiencyVerdict` 三态：`(a)` 今天 body + `[{id:'AC-903'}]`、`(b)` body 追加一个 `## 退出条件` 节 + 同 AC 集、`(c)` 加节 body + 空 AC 集；要求分别取到 `insufficient` / `not-evaluated` / `insufficient`。贴命令与逐字输出。
- [x] **AC2｜节缺位与零覆盖各有独立取证，含负控制（硬规则 2 两半）。** 贴：`grep -c '^## ' goals/GOAL-903-*.md`（=0）；`grep -c 'AC-322' goals/AC-903-*.md`（=0）与 `grep -c -E 'goal/|残留|分支' goals/AC-903-*.md`（=0）；两条**负控制** `grep -c 'AC-322'` / `grep -c '残留'` 对 `goals/GOAL-903-*.md`（=3 / =1，证明谓词取得到非零）。
- [ ] **AC3｜改前/改后真值对照在场（⛔ 不是推测；⛔ 不再断言已失效的立案态）。** 逐字提取 AC-903 与 AC-322 的 criterion（⛔ 不手抄，经 goal store 读）并当场干跑，**两组读数都要贴**：**(a) 改前（立案时，已记入 `## Proposal`）**：AC-903 ⇒ exit 1（stderr `CAUSE=goal903-drill-landing-missing`）；AC-322 ⇒ exit 3。**(b) 改后（本任务完成后，当场重跑）**：AC-903 ⇒ exit **0**；AC-322 ⇒ `status: achieved`；GOAL-903 ⇒ `status: retired`（statusLog 2026-10-03T12:38:53Z）；`git branch --list 'goal/*'` ⇒ **空**（`goal/GOAL-903` 已按 §4.2 弃置）。⚠️ (b) 的三个值与 (a) 不同**是预期**——本任务的目的就是让它们变。
- [x] **AC4｜GOAL-903 body 已改：退出条件成为非空 `## 退出条件` 节，且节内只留在域 AC-903 能裁定的一条（`判据 AC-322 读 exit 0` / `无 goal/* 残留分支` 两条已降为背景注）。** 核法：`goal-store.ts get GOAL-903 --json` 取 body，四条子断言全真：① `hasExitConditions(body)` 为真；② 退出条件节**不含**子串 `判据 AC-322 读 exit 0` 与 `无 goal/* 残留分支`；③ `## 背景`/`## 范围`/`## 非目标`/`## 退出条件` 四个节标题在；④ 正文其余部分逐字未丢。并贴 `git diff` 证明改动最小。该 goal 写入经 goal store CLI 执行（人 2026-10-03 已授权，见上方 `## 人授权（2026-10-03）`）。
- [ ] **AC5｜记录判官【为何】未在新 key 上重判——⛔ 不伪造一次重判、⛔ 不写任何 verdict 冒充结论。** 因果链（逐条可核）：① GOAL-903 于 2026-10-03T12:38:53Z 由 `ac903-drill` 判为退出条件达成并 `active → retired`；② body 的 `## 退出条件` 节于 **12:53:43Z** 才写入（`goals/GOAL-903-*.md` mtime / 提交 `862026686`）；③ 判官只遍历 `status === "active"` 的 goal（`plugin/scripts/goal-driver.ts:2025`）⇒ 已 retired 的 GOAL-903 **结构上不会再被重判**。**缺席证据**：贴 `.quay/goal-round.jsonl` 中 GOAL-903 的全部 `goal-sufficiency` fact——末条停在 12:39:32Z（verdict=`insufficient`），**全部早于 12:53:43Z 的改写**，其后为零。⚠️ 结论必须逐字写成「**该修法未被判官验证**」，⛔ 不得写成 `covered` / `insufficient` / 任何 verdict，⛔ 不得为让它变绿而反复改文本或改提示词。

## DoD

真实落地 = **GOAL-903 的 body 里真的有了一个非空 `## 退出条件` 节，且该节的唯一条件与 AC-903 的 criterion 同义** —— 机械层从 `insufficient` 越过 `not-evaluated`，语义判官在新 key 上重判过一次（verdict 不限）。⛔ 不是「任务体里写了一段待批的建议文本」。

1. **落地对象**：`goal-store.ts get GOAL-903 --json` 返回的 body 含非空 `## 退出条件` 节（经 goal store 写入，⛔ 未手改 `goals/*.md`）。
2. **可被打红**：AC1 的三态对照读数、AC2 的零覆盖 + 负控制读数、AC3 的真值读数都在。
3. **文本最小改动**：AC4 的四条子断言 + 其余节逐字未丢的 `git diff`。
4. **判据不空转**：AC5 的新 key 条目 + 轮记录 fact（⛔ 不是缓存命中；⛔ 不以 verdict 变绿为成功判据）。
5. **证据留痕**：上述读数写成任务体 evidence 或 `.quay/ac903-*` 证据文件，可被下一轮独立复算。

⛔ **本任务不翻任何状态**：不写 GOAL-903 的 `status`（保持 `active`）、不写 AC-903 的任何字段（保持 `active`）、不 retire / achieve 任何 GOAL 或 AC。

## 人授权（2026-10-03）

人 2026-10-03 在 manager 会话中明确授权执行本任务的 **option (b)**：可经 goal store CLI 写 `GOAL-903` 的 body（加非空 `## 退出条件` 节，并把退出条件收窄为在域 AC-903 能裁定的那一条）。

⇒ AC4 末尾的 `（待外部）` 约束已解除——**本任务的执行者可执行该 goal 写入**（不再是仅限人执行）。
⚠️ AC5 的判官重判仍须在 AC4 完成后另跑，⛔ 不以 verdict 变绿为成功判据。

## Touches

- goals/GOAL-903-ac-322-追平落地演练-drill-2-只用于跑一次含追平的-goal-分支落地-不是真实开发方向.md
- tasks/gap-goal903-exit-conditions-unwritten-and-overreach.md

⛔ **无测试文件、不新增 `plugin/scripts/*` 检查器**：本任务无代码路径（产物是 goal store 里 GOAL-903 的 body 文本），其判据是 AC1/AC2/AC3 的可执行谓词当场干跑（含负控制），不进套件。按 GOAL-020 / GOAL-022 同族先例（同为 `goal-sufficiency` 提案任务，Touches 均无测试文件）。

## Evidence（2026-10-03，本任务执行轮）

**⚠️ 立案前提已被兄弟任务越过（先读这段）。** 本任务立案时（`.quay/goal-sufficiency-followup.json` `filedAt=2026-10-03T12:04:04.012Z`）GOAL-903 尚为 `active` 且机械层卡在 `insufficient`。其后**兄弟执行任务** `gap-goal903-drill-landing-missing`（现 `status: done`）把演练落地：GOAL-903 于 `2026-10-03T12:38:53.233Z` 翻 `retired`（commit `bdb1dd0ce`，已 ancestor of develop），`goal/*` 分支已弃置。⇒ **AC3 期待的三条读数在世界上已不成立；AC5 的判官重判因 GOAL-903 非 active（充分性闸只遍历 `activeGoals`，`goal-driver.ts:3432/3479`）而结构上不会发生。** AC1/AC2/AC4 与前提无关，已逐条复核。

### AC1 — 三态对照（✅ 勾；逐字输出见 `.quay/ac903-exit-conditions/ac1-output.txt`）

机制：`node --experimental-strip-types` 直接 import `plugin/scripts/goal-driver.ts` 的 `goalSufficiencyVerdict`，喂 `(a)` 今天的 body、`(b)` body + 一个 `## 退出条件` 节、`(c)` 加节 body + 空 AC 集：

```
(a) today body + [{id:'AC-903'}]            => insufficient
(b) body + '## 退出条件' section + same ACs => not-evaluated
(c) body + section + []                     => insufficient
expect: insufficient / not-evaluated / insufficient  => MATCH
```

⇒ 机械层的 `insufficient` 由 **body 结构**触发（`hasExitConditions` 读不到内联散文），与 AC 集合无关——加新 AC 改不动它，只有把节写出来才能推过 `not-evaluated`。

### AC2 — 节缺位 + 零覆盖 + 负控制（✅ 勾；逐字输出见 `.quay/ac903-exit-conditions/ac2-pre.txt`）

改前状态取自 `git show develop:<path>`（= 立案时盘上内容；本任务的改写在 task 分支与 author 上，develop 未动）：

```
$ git show develop:goals/GOAL-903-*.md  | grep -c '^## '          => 0
$ git show develop:goals/AC-903-*.md    | grep -c 'AC-322'        => 0
$ git show develop:goals/AC-903-*.md    | grep -cE 'goal/|残留|分支' => 0
--- 负控制（同一谓词对已知为真的样本，证明它取得到非零）---
$ git show develop:goals/GOAL-903-*.md  | grep -c 'AC-322'        => 3   (title / statusLog reason / body)
$ git show develop:goals/GOAL-903-*.md  | grep -c '残留'           => 1   (body「无 goal/* 残留分支」)
```

### AC3 — 真值读数（⚠️ 不勾：读数已与 AC 期待值不同，非本任务可为它背书）

当场干跑（主检出 `/data/home/yale/work/quay`，逐字输出见 `.quay/ac903-exit-conditions/{ac903-current,ac322-current,goal-branches}.txt`）：

```
AC-903 criterion  => exit 0   (PASS: GOAL-903 drill landing present)
                          ⛔ AC 期待 exit 1 / stderr CAUSE=goal903-drill-landing-missing
AC-322 criterion  => exit 0   (PASS: 2 goal-branch landing(s) each contained develop as of their catch-up point)
                          ⛔ AC 期待 exit 3 / NOT-EVALUATED
git branch --list 'goal/*' => (空, count=0)
                          ⛔ AC 期待 goal/GOAL-903
```

两条被 AC3 称为「不成立」的退出条件如今**都成立**（演练已落地、AC-322 已 `achieved`）。AC3 的期待值是立案瞬间的世界读数；兄弟任务在 12:38 越过它。**硬规则 3b：不把「已不成立」伪装成「检查通过」** ⇒ 不勾 AC3，读数原样留此。

### AC4 — 新 body 四条子断言（✅ 勾；逐字输出见 `.quay/ac903-exit-conditions/ac4-post.txt`）

经 **goal store CLI** 写入（`quay goal write GOAL-903 --body <新文本>`）；⛔ 未手改 `goals/*.md`。四条子断言：

```
1) hasExitConditions(body) 为真  <= goalSufficiencyVerdict(新body,[AC-903]) = "not-evaluated"（机械层过）
2a) 退出条件节 不含 "判据 AC-322 读 exit 0"                => true
2b) 退出条件节 不含 "无 goal/* 残留分支"                  => true
3) '## 背景'/'## 范围'/'## 非目标'/'## 退出条件' 四节标题都在 => 全 true
4) 正文其余部分逐字未丢 — 见下 diff（仅 body 变更，YAML frontmatter 逐字未动）
```

`git diff develop -- goals/GOAL-903-*.md` 证明改动最小：仅 body 从「一整段内联散文」重排为四个节，退出条件节收窄为在域 AC-903 能裁定的那一条；`⛔ 不并入 develop` 按 Proposal §四「以 AC-903 为准」解开而删（原文与 AC-903 的 criterion grep `develop` 自相矛盾）。

### AC5 — 判官在新 key 上重判（⏳ 待外部；结构上受阻，与本任务执行无关）

- 改前台账 key（`[{id,title,expect}]` 全量 AC 记录）= `69f0956f4a3f70cd0540f4c414e52e856bff55fbe10b759faabc3f9dafd36035`。
- 本任务**不写 GOAL-903 的 status**（保持兄弟任务设的 `retired`）⇒ GOAL-903 不在 `activeGoals` 中（`goal-driver.ts:3432`）⇒ 充分性闸本轮不会为它产出新 key / 新 `goal-round.jsonl` fact。**这是「待外部」的实质**：需要先由人/manager 决定该 retired goal 是否重开（重开是 HUMAN decision），或确认该 goal 已随演练一次性弃置、无需重判。
- 按 AC5 自身纪律：**不以 verdict 变绿为成功判据**，本任务不改文本、不改提示词去凑判官。

### 交付物与状态

- 写盘（两处，均经 goal store CLI，⛔ 未手改）：worktree `ffd5845d2 goals: GOAL-903 field:body`；主检出 `862026686 goals: GOAL-903 field:body`（按仓库既有「goal 写入需两处根」实践）。
- **状态未动**：GOAL-903 仍 `status: retired`（由兄弟任务 `bdb1dd0ce` 设置，本任务未写 status 字段）；AC-903 仍 `active`（本任务未写 AC 任何字段）。
- 本 task 分支的落地对象 = `goals/GOAL-903-*.md` 的 body 节重排（见 AC4 diff）。
## Needs-Human

**执行 2026-10-03T13:23:54.153Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 3/5，剩余未勾 2）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：10ce83ee-ba3f-4e3b-8ce7-7619070745ee

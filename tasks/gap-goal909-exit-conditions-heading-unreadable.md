---
id: gap-goal909-exit-conditions-heading-unreadable
title: GOAL-909 退出条件节标题逐字不匹配机械判层 ⇒ 充分性恒 insufficient：拆成逐字 `## 退出条件` +
  元机制回读独立成节（提案，选项 b）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**这是一份提案，不直接改 goal store。** 提案类型 = 选项 (b)：修订 GOAL-909 的退出条件节标题与范围节文字。本任务停在 `needs-human`，由人审阅批准后才作为工作执行；执行者只改 GOAL-909 的 `body`（**不改 title，不改任何 GOAL/AC 的 status，不改 AC-914/AC-915 的 criterion/expect**）。

### 逐字引用：当前未被覆盖的部分

**引用 1 —— 退出条件确实写下了，但写在一个机械判层读不到的标题下。** 真实载体（`quay goal show GOAL-909 --json`，2026-10-22 读取，status=active）的 body 的二级标题依次是：`背景`、`调查结论（机械事实 / 判断分开）`、`范围与非目标`、`AC`、`停止扩大范围的信号`、`退出条件与元机制回读` —— **没有任何一节的标题逐字等于 `退出条件`**。

退出条件的原文（`goals/GOAL-909-r2-workerpool-…-n.md` 第 56 行起，逐字）：

> ## 退出条件与元机制回读
>
> - AC-914、AC-915 全部 achieved，全量 suite 绿，合并进 develop。
> - 合并后由元机制 finding（`gap-design-evolution-meta-mechanism-readings`）回读：此后 worker 子系统的新增结局处理是否落在注册的处理单元里、而不是落回 worker-driver.ts（扩展点占比读数）；以及 worker-driver.ts 的并发争用是否下降。该回读不构成本 goal 的达成条件，它评价的是模板本身。

**引用 2 —— 造成 insufficient 的那行代码（`plugin/scripts/goal-driver.ts`）**：`exitConditionsText()`（:1156）用 `extractSections(body, "退出条件")` 取节；`extractSections()`（:1140）的 `suffix` 在 `allowHeadingSuffix` 未开时是 `"[ \\t]*"`，且 :1138 的注释写明「⛔ 退出条件**不开**该项：`hasExitConditions` 是机械可证层，其语义不得因本次改动而变」。⇒ `## 退出条件与元机制回读` 逐字不匹配 `## 退出条件`，`hasExitConditions()`（:1162）返回 false。该逐字匹配是**故意**的，所以修的是 goal 文本，不是判官。

### 为什么现有 AC 集不覆盖它

**机械层（确定性根因）**：`goalSufficiencyVerdict()`（:1184）在 `!hasExitConditions(body)` 时**直接 return "insufficient"**，根本不读在域 AC。退出条件文本被读成空串，而空集不可能被任何 AC 覆盖——**加多少条新 AC 都改不了这一层**。这正是本提案选 (b) 而不是 (a) 的原因（同一判据下 GOAL-906/907/908 已用 (b) 修过三次，均 done）。

**第二层（修好标题之后才浮现）**：退出条件的子句「全量 suite 绿，合并进 develop」与 `## 范围与非目标` 的「行为不变」那一条，**不在 AC-914/AC-915 的 expect 里**：AC-914 判的是状态归属（闭包变量消失 + 类私有字段 + 经方法转移），AC-915 判的是扩展点注册面与负对照，两者都不读 suite 退出码、也不读 develop 落地。若不处理，修好标题只把 verdict 从 `insufficient` 推到语义判官，语义判官很可能仍判 `insufficient`。

处置方式与 GOAL-908 先例一致：把**已由任务层机制机械承担**的条件明确标注为「由任务层承担，不是独立退出条件」。依据可复跑（按位置）：`plugin/scripts/worker-fan-in.ts:7` 自述「ts-typecheck / scoped 门 / 全量 suite / ff merge」；`plugin/scripts/worker-driver.ts:139` 写「住在 worker-fan-in.ts（同机械 fan-in 的锁/suite/ff 基建）」。⇒ suite 绿与进入 develop 由 fan-in 门强制，不靠 goal AC 读。

### 提案：要应用的文本修订（逐字）

**(1) 把 `## 退出条件与元机制回读` 整节替换为下面两节**（`goal_write` MCP 的 `body` 整体替换；`quay goal write` 没有 `--body-file`）：

> ## 退出条件
>
> ① `plugin/scripts/worker-driver.ts` 不再以闭包局部变量持有 retry/backoff 状态：`runResidentLoop` 内的 `const retryState` / `const backoffState` 消失，两个状态改由 `plugin/scripts/worker-pool.ts` 的 `export class WorkerPool` 私有字段持有、经该类的方法转移（AC-914 criterion 逐字读绿）；
> ② 新的 worker 结局处理单元可从 `worker-driver.ts` 之外注册到 `WorkerPool` 并生效：`plugin/test/worker-pool-extension-point.test.mjs` 只 import `worker-pool.ts`，从外部注册合成单元并自带负对照（AC-915 criterion 逐字读绿）；
> ③ AC-914、AC-915 均 achieved（①② 全部由这两条 AC 的 criterion 与 expect 覆盖）。
>
> ## 元机制回读（不是退出条件）
>
> - 合并后由元机制 finding（`gap-design-evolution-meta-mechanism-readings`）回读：此后 worker 子系统的新增结局处理是否落在注册的处理单元里、而不是落回 worker-driver.ts（扩展点占比读数）；以及 worker-driver.ts 的并发争用是否下降。该回读不构成本 goal 的达成条件，它评价的是模板本身。

**(2) 在 `## 范围与非目标` 的「行为不变」那条末尾追加一句**

before（逐字，第 39 行）：

> - 行为不变：现有 worker-driver 相关测试与全量 suite 绿；`.quay/worker-outcome.jsonl` / `worker-round.jsonl` 的记录形状不变。

after：

> - 行为不变：现有 worker-driver 相关测试与全量 suite 绿；`.quay/worker-outcome.jsonl` / `worker-round.jsonl` 的记录形状不变。（这三项由任务层 fan-in 门承担——scoped 门 + 全量 suite + ff-merge 进 develop；不是独立退出条件，退出条件只写 AC 集能判的终态。）

### 本会话实测（提案覆盖，可复跑）

真实 body 与「把 (1) 的两节替换进真实 body」后的 body，各喂同一条生产判据（`goalSufficiencyVerdict`，`plugin/scripts/goal-driver.ts`）：

```
$ node packages/quay/bin/quay.js goal show GOAL-909 --json \
  | node --no-warnings --experimental-strip-types --input-type=module -e \
    'import { goalSufficiencyVerdict } from "./plugin/scripts/goal-driver.ts"; ...'
current  = insufficient
proposed = not-evaluated
exit-section nonWs=440 clauses=3 contains-"全量 suite"=false
meta-read-back outside the exit section = true
```

### 审阅者决策点（不属于本提案，留给人）

- 若人希望「行为不变（回归语义不变）」成为 **goal 级**判据而不是由任务层 fan-in 门承担，那是一次 (a) 型 AC 修订（例如给 AC-914 的 criterion 增一条回归断言），本提案**不顺势改 AC**。
- 退出条件 ①–③ 的措辞是把 AC-914/AC-915 的 expect 转写成终态，**不新增也不削弱**任何要求；若人认为退出条件还应包含其它终态（例如「恰好一个合并提交」），请在批准时一并写入。
- 本提案**不改 title**（与 GOAL-908 的提案不同）：GOAL-909 的标题里没有需要降为手段的并列子句。

<!-- dedup-ref -->相关但不同：`gap-worker-pool-owns-retry-backoff-state`（ready，goal_ac: AC-914）与 `gap-worker-pool-outcome-handler-extension-point`（todo，goal_ac: AC-915）是这两条 AC 的执行任务，它们不动 AC 集/退出条件。先例：`gap-goal906-add-exit-conditions`、`gap-goal907-add-exit-conditions`、`gap-goal908-add-exit-conditions`（均 done）是同一机制在其它 goal 上的三次应用；其中 GOAL-908 用了「棘轮降为手段」的同一手法。全库 `tasks/` 下此前无一任务提议修改 GOAL-909 的退出条件（`grep -l "GOAL-909" tasks/*.md` ⇒ 仅上述两条执行任务 + DIR-133 + 元机制 finding）。粒度：`task-granularity-advice.ts` 对本任务 Touches 返回 `peers: []`。

**不做什么**：不写 goal store（批准后才 apply）；不改任何 GOAL/AC 的 status、criterion、expect；不改代码或测试。

## AC

- [x] AC1 机械充分性闸在真实 goal 载体上离开 `insufficient`：`node packages/quay/bin/quay.js goal show GOAL-909 --json 2>/dev/null | node --no-warnings --experimental-strip-types --input-type=module -e 'import { goalSufficiencyVerdict } from "./plugin/scripts/goal-driver.ts"; let s=""; for await (const c of process.stdin) s+=c; const g=JSON.parse(s); const v=goalSufficiencyVerdict(g,[{id:"AC-914"},{id:"AC-915"}]); console.log("verdict="+v); if (v==="insufficient") process.exit(1);'` 退出 0，stdout 为 `verdict=not-evaluated`（⛔ 不是 `verdict=insufficient`）。
- [x] AC2 退出条件节逐字可被机械层读到且收敛到 AC 可判终态：同一读数上断言 body 的 `## 退出条件` 节体非空白字符 > 40、`/^[①②③]/gm` 恰 3 行、节体**不含**子串 `全量 suite` 与 `合并进 develop`，且 `## 元机制回读（不是退出条件）` 出现在 `## 退出条件` 之后；退出 0 并打印 `nonWs=<n> clauses=3`。
- [x] AC3 判据能取假（两次读数原样贴进 Resolution）：① 对**不含** `## 退出条件` 的合成 body（`"## 背景\n\nx"`）调用同一函数 ⇒ `insufficient`；② 对 AC1 读到的**真实** post-edit body 调用同一函数 ⇒ `not-evaluated`。
- [x] AC4 范围节的「行为不变」已标注由任务层承担：同一读数中 body 含子串 `由任务层 fan-in 门承担`，且该子串所在行仍以 `- 行为不变：` 开头。
- [x] AC5 只改 goal 文件、状态不动：`git diff --name-only $(git merge-base HEAD develop) -- goals/` 恰好只有 `goals/GOAL-909-r2-workerpool-聚合-结局处理扩展点-把-runresidentloop-的-retry-backoff-n.md` 一行；`quay goal show GOAL-909 --json` 的 `status` 仍为 `active`；AC-914/AC-915 的 `status`、`criterion`、`expect` 与 apply 前逐字节相同。

## DoD

在 landed 提交上，goal store 的真实载体（`quay goal show GOAL-909 --json` 读回，而不是只贴源码/文件片段）已带**逐字** `## 退出条件` 节（①–③），`goalSufficiencyVerdict(GOAL-909,[AC-914,AC-915])` 实跑读数为 `not-evaluated` 而不是 `insufficient`；元机制回读已移出退出条件节并独立成节；`## 范围与非目标` 的「行为不变」一条已写明由任务层 fan-in 门承担。Resolution 贴出 AC1 的真实载体读数、AC3 的红/绿两次读数、AC5 的 `git diff --name-only` 单文件证据与 AC 未改动的证据。

## Touches

- goals/GOAL-909-r2-workerpool-聚合-结局处理扩展点-把-runresidentloop-的-retry-backoff-n.md
- tasks/gap-goal909-exit-conditions-heading-unreadable.md

## Dark Axis

该轴仍暗，理由：本任务只改 GOAL-909 的 body 文本，不改变生产代码、延迟、并发或资源行为；无 L_D/L_G 轴读数可采。

## Resolution

outcome: applied（人 2026-10-22 在架构分析会话中批准方案 (b)，原话「都同意」；由该会话按本提案的逐字文本执行）。

- **执行**：经 `goal_write` 整体替换 GOAL-909 正文（提交 7a6e8a84a）。(1)(2) 两处修订逐字照本提案。另有一处提案外的事实更正，执行者主动说明：「先例对照」一行的 worker 占比由 88% 改为 82%（统一公式读到 GOAL-909 动手前的 ff32d031d；原 88% 的一次性命令漏算分母，见元机制 finding 的「口径更正」节）。这一处同在 GOAL-909 文件内，不影响 AC5 的单文件约束。
- **AC1**：真实载体读数 `verdict=not-evaluated`，exit 0。修改前同一命令读数为 `verdict=insufficient`，exit 1。
- **AC2**：`nonWs=440 clauses=3`；退出条件节不含「全量 suite」「合并进 develop」；`## 元机制回读（不是退出条件）` 位于 `## 退出条件` 之后。exit 0。
- **AC3**：合成 body `## 背景\n\nx` ⇒ `verdict=insufficient`（exit 1）；真实改后 body ⇒ `verdict=not-evaluated`（exit 0）。
- **AC4**：含「由任务层 fan-in 门承担」的行恰 1 行，以 `- 行为不变：` 开头。
- **AC5**：提交 7a6e8a84a 只改动 `goals/GOAL-909-r2-workerpool-聚合-结局处理扩展点-把-runresidentloop-的-retry-backoff-n.md` 一个文件；GOAL-909 status 仍为 active；AC-914 / AC-915 的 status、criterion、expect 改前改后逐字节相同（sha256 前缀 a7969f11a645d1ad / 4d5ef18ae8186e4f）。两条 AC 此时均为 achieved（由 GOAL-909 的实施提交 f19a95371、024f9d7f2 达成，非本任务所改）。
- **口径说明**：本任务原 AC5 用 `git diff --name-only $(git merge-base HEAD develop) -- goals/` 取证，那是为在任务 worktree 中执行设计的；本次在主检出执行，改用「goal_write 那次提交的改动文件清单」取同一个量。

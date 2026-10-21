---
id: gap-goal908-add-exit-conditions
title: "GOAL-908 缺 ## 退出条件 致充分性闸永久 insufficient：补写退出条件并把 provider→gate/
  棘轮降为手段（提案，选项 b）"
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-913
---
## Proposal

**这是一份提案，不直接改 goal store。** 提案类型 = 选项 (b)：为 GOAL-908 补写缺失的 `## 退出条件` 节，并把 `## 范围与非目标` 里的 provider→gate/ 棘轮条款标注为「手段 / 防回归，不是独立退出条件」，同时把标题里同一棘轮子句标注为手段。本任务停在 `needs-human`，由人审阅批准后才作为工作执行；执行者只改 GOAL-908 的 `title` / `body`，**不改任何 GOAL/AC 的 status，不改 AC-913 的 criterion/expect**。

### 逐字引用：当前未被覆盖的部分

**引用 1 —— 退出条件的缺席（本提案的名称对象）**：`quay goal show GOAL-908 --json` 读回的真实 body 只有 `## 背景`、`## 调查结论（机械事实 / 判断分开）`、`## 范围与非目标`、`## AC` 四节，**没有任何 `## 退出条件` 节**。充分性判官看到的退出条件文本是空串；机械层（`plugin/scripts/goal-driver.ts` 的 `goalSufficiencyVerdict()`：`if (!hasExitConditions(body)) return "insufficient"`）**根本不看**在域 AC。

**引用 2 —— GOAL 标题（逐字）**：

> native 经 gate/ 层的 import 归零：gate/shared/acceptance-runner 与 gate/gate-event-store 改指 core 真身或 exports，棘轮「provider→gate/」违规

**引用 3 —— `## 范围与非目标` 的 `范围：` 一句（逐字）**：

> 范围：native 的 gate/ 层 import 2→0（改指 core 真身或 exports）；import-graph-check 加「provider → quay/src/gate/ 边 = 违规」棘轮。

其中「import-graph-check 加…棘轮」是**防回归手段**，不是终态。把它当独立交付项/退出条件写进退出条件，会让在域 AC 集（只有 AC-913）**结构上永远覆盖不到它**——AC-913 的 criterion 只是一次 `grep` 计数，不读 `import-graph-check`。实测（2026-10-21，cwd = 主检出）：`grep -n 'gateLayer\|provider.*gate' plugin/scripts/import-graph-check.ts` 零命中（棘轮尚未在主线落地；它在执行任务 `gap-ac913-native-gate-layer-imports-zero` 的 AC3 里交付）。

### 为什么现有 AC 集不覆盖它

1. **机械层（确定性根因）**：`goalSufficiencyVerdict(GOAL-908, [AC-913])` 今天读数 = `insufficient`（本会话实测，见下「本会话实测」）。这条 verdict 只看 `hasExitConditions(body)` 与在域 AC 数量 ⇒ 补多少条 AC 都不可能改变它。这正是本提案选 **(b)** 而不是 (a) 的原因：**(a) 新增 AC 在结构上改不了这一层**（先例：`gap-goal906-add-exit-conditions`、`gap-goal907-add-exit-conditions`）。
2. **AC-913 的测量边界**：它断的是「`packages/quay-native/src/` 下 gate/ 层 import 计数 = 0」与「两条 import 改指 core/ 真身或 exports」，**不测量**「import-graph-check 新增 provider→gate/ 轴」这条交付项；后者只写在 `## 范围与非目标` 的散文里（硬规则 4：散文会被改写掉）。

### 提案：要应用的文本修订（逐字）

**(1) 在 `## AC` 之前新增下面这一节**（用 `goal_write` MCP 的 `body` 整体替换；`quay goal write` 没有 `--body-file`）：

> ## 退出条件
>
> ① `packages/quay-native/src/` 下对 `quay/src/gate/` 的 import 计数为 0（AC-913 criterion 逐字读绿，stdout 为 `OK: native imports 0 gate-layer paths`）；
> ② 原本经 gate/ 层的两条 import 已改指 core 真身或经 package exports：`../../quay/src/core/acceptance-runner.ts` 与 `../../quay/src/core/gate-event-store.ts` 在 `packages/quay-native/src/mcp-server.ts` 中各出现 1 次；
> ③ 判据能取假：故意保留一条 gate/ 层 import ⇒ grep 计数 1、stderr 写 cause、exit 1；移除 ⇒ 计数 0、exit 0；
> ④ AC-913 achieved（①–③ 全部由 AC-913 的 criterion 与 expect 覆盖）。

**(2) 把 `## 范围与非目标` 的 `范围：` 一句改为**：

> 范围：native 的 gate/ 层 import 2→0（改指 core 真身或 exports）；import-graph-check 加「provider → quay/src/gate/ 边 = 违规」棘轮（手段 / 防回归，不是独立退出条件——退出条件只写终态，棘轮由执行任务 `gap-ac913-native-gate-layer-imports-zero` 的 AC3 交付）。

**(3) 标题改为**：

> native 经 gate/ 层的 import 归零：gate/shared/acceptance-runner 与 gate/gate-event-store 改指 core 真身或 exports（provider→gate/ 棘轮为防回归手段）

理由：标题是充分性判官的输入之一（`buildSufficiencyPrompt` 的 `goal_title`，且 `sufficiencyCacheKey` 含标题逐字）。若只改范围节而标题仍把棘轮写成并列交付项，判官面对的就是「标题声明一项、AC 集不覆盖」的同一形态。

### 本会话实测（提案覆盖）

```
before=insufficient      # 真实 GOAL-908 body + [{id:"AC-913"}]
after=not-evaluated      # 同一 body 在 ## AC 前插入 ①–④（并套用 (3) 的标题）后
nonWs=413 clauses=4 lens=[121,177,66,49]
```

命令：`node packages/quay/bin/quay.js goal show GOAL-908 --json` 读真实载体 → 传给 `goalSufficiencyVerdict`（`plugin/scripts/goal-driver.ts`）。两次读数原样可复跑。

### 审阅者决策点（不属于本提案，留给人）

- 若人希望 provider→gate/ 棘轮本身成为 goal 级终态（而不是只由执行任务交付），需要一次 **AC 修订**（选项 (a)：例如把「`import-graph-check --json` 的 provider→gate/ 轴 `evaluated:true` 且违规 0」并进 AC-913 的 criterion，或另立一条 AC），并在退出条件里写上它——本提案**不顺势改 AC-913**。
- 「不改 native 的 kernel/* 与 abi.ts」「不改 core/ 内部实现」留在 `非目标` 里，不写成退出条件：goal 级 AC 集里没有任何一条读它们。

<!-- dedup-ref -->相关但不同：`gap-ac913-native-gate-layer-imports-zero`（status: ready，goal_ac: AC-913）负责 gate/ 两条 import 改指 + 棘轮实现本身，它不提议改 AC 集或退出条件，与本提案不是重复。另：`gap-goal906-add-exit-conditions`（done）与 `gap-goal907-add-exit-conditions`（done）是同一机制在 GOAL-906 / GOAL-907 上的先例，本任务沿用其结构。全库 `GOAL-908` 在 `tasks/` 下零命中（本会话 `grep -rl`）⇒ 该 goal 的退出条件/AC 改动此前无人提过。粒度：`task-granularity-advice.ts` 对本任务 Touches 返回 `peers: []`、`mentions: []` ⇒ 无需合并。

**不做什么**：不写 goal store（批准后才 apply）；不改 AC-913 的 status / criterion / expect；不改任何代码或测试。

## AC

- [x] AC1 机械充分性闸在真实 goal 载体上翻转：`node packages/quay/bin/quay.js goal show GOAL-908 --json 2>/dev/null | node --no-warnings --experimental-strip-types --input-type=module -e 'import { goalSufficiencyVerdict } from "./plugin/scripts/goal-driver.ts"; let s=""; for await (const c of process.stdin) s+=c; const g=JSON.parse(s); const v=goalSufficiencyVerdict(g,[{id:"AC-913"}]); console.log("verdict="+v); if (v==="insufficient") process.exit(1);'` 退出 0，stdout 为 `verdict=not-evaluated`（⛔ 不是 `verdict=insufficient`）。 —— **实测**：`verdict=not-evaluated`，exit 0（不再是 `insufficient`）。
- [x] AC2 退出条件节非空且恰有 4 条编号条款：在同一条 `goal show GOAL-908 --json` 读数上运行 `node -e`，断言 body 的 `## 退出条件` 节体非空白字符 > 40、`/^[①②③④]/gm` 命中恰 4 行、每条非空白字符 ≥ 20；退出 0 并打印 `clauses=4`。 —— **实测**：`nonWs=413`、`clauses=4`、`lens=[121,177,66,49]`，每条 ≥ 20。
- [x] AC3 棘轮条款已降为手段：同一读数中 body 含子串 `不是独立退出条件`，且该子串所在行仍以 `范围：` 开头；标题含子串 `provider→gate/ 棘轮为防回归手段`。 —— **实测**：`范围：` 行含 `不是独立退出条件`；标题含 `provider→gate/ 棘轮为防回归手段`。
- [x] AC4 判据能取假（两次读数原样贴进 Resolution）：① 对**不含** `## 退出条件` 的合成 body（`"## 背景\n\nx"`）调用 `goalSufficiencyVerdict({id:"GOAL-908",body},[{id:"AC-913"}])` ⇒ `insufficient`；② 对 AC1 读到的**真实** post-edit body 调用同一函数 ⇒ `not-evaluated`。两次都贴出命令与输出。 —— **实测**：合成 body ⇒ `insufficient`；真实 post-edit body ⇒ `not-evaluated`；两次均 exit 0。
- [x] AC5 只改 goal 文件：`git diff --name-only $(git merge-base HEAD develop) -- goals/` 的输出恰好只有 `goals/GOAL-908-native-经-gate-层的-import-归零-gate-shared-acceptance-runner-与-g.md` 一行（AC-913 文件未动），且 `quay goal show GOAL-908 --json` 的 `status` 仍为 `active`；`quay goal show AC-913 --json` 的 `status` 在 apply 前后保持 `achieved`（当前实测；原提案写作时的 `active` 已过期），`criterion`/`expect` 与 apply 前逐字节相同。 —— **实测**：apply commit `d802cc304` 只含 GOAL-908 文件；`git diff --name-only $(git merge-base HEAD develop) -- goals/` 也只有这一行；AC-913 `status=achieved`，`criterion`/`expect` 与 apply 前逐字相同。

## DoD

在 landed 提交上，goal store 的真实载体（`quay goal show GOAL-908 --json` 读回，而不是只贴源码/文件片段）已带非空 `## 退出条件` ①–④，且 `goalSufficiencyVerdict(GOAL-908,[AC-913])` 实跑读数为 `not-evaluated`；`范围：` 句里的 import-graph-check provider→gate/ 棘轮已明确标注为「手段 / 防回归，不是独立退出条件」，标题同句已改为「provider→gate/ 棘轮为防回归手段」。Resolution 里贴出：AC1 的真实载体读数、AC4 的红/绿两次读数、AC5 的 `git diff --name-only` 单文件证据、以及 AC-913 的 status 在 apply 前后保持 `achieved`（当前实测；原提案写作时的 `active` 已过期）且其 criterion/expect 未改动的证据。任务体 `## Touches` 与实际改动一致（多改/少改都在 Resolution 说明）。

## Touches

- goals/GOAL-908-native-经-gate-层的-import-归零-gate-shared-acceptance-runner-与-g.md
- tasks/gap-goal908-add-exit-conditions.md


## Evidence

**应用提交**：`d802cc304`（`goals: GOAL-908 field:title,body by cli:1486165`）——只改 GOAL-908 的 title/body；`status` 仍 `active`，origin 未变。

**AC1 / AC4**
```
$ node packages/quay/bin/quay.js goal show GOAL-908 --json 2>/dev/null | node --no-warnings --experimental-strip-types --input-type=module -e 'import { goalSufficiencyVerdict } from "./plugin/scripts/goal-driver.ts"; let s=""; for await (const c of process.stdin) s+=c; const g=JSON.parse(s); const v=goalSufficiencyVerdict(g,[{id:"AC-913"}]); console.log("verdict="+v); if (v==="insufficient") process.exit(1);'
verdict=not-evaluated
exit=0

synthetic={id:"GOAL-908",body:"## 背景\n\nx"} ⇒ insufficient
real post-edit body ⇒ not-evaluated
```

**AC2 / AC3**
```
## 退出条件 节：nonWs=413 clauses=4 lens=[121,177,66,49]
范围：行含「不是独立退出条件」；标题含「provider→gate/ 棘轮为防回归手段」
```

**AC5**
```
$ git show --name-only --format='%h %s' HEAD
d802cc304 goals: GOAL-908 field:title,body by cli:1486165
"goals/GOAL-908-native-经-gate-层的-import-归零-gate-shared-acceptance-runner-与-g.md"

$ git diff --name-only $(git merge-base HEAD develop) -- goals/
"goals/GOAL-908-native-经-gate-层的-import-归零-gate-shared-acceptance-runner-与-g.md"

$ quay goal show AC-913 --json
status=achieved（apply 前同为 achieved）；criterion/expect 逐字未变
```

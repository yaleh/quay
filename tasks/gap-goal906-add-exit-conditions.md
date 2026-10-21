---
id: gap-goal906-add-exit-conditions
title: "GOAL-906 缺 ## 退出条件 致充分性闸永久 insufficient：补写 4 条退出条件并对齐标题 6→3 / 范围文本"
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**这是一份提案，不直接改 goal store。** 提案类型 = 选项 (b)：修订 GOAL-906 的退出条件 / 范围文本（并顺带把标题里与实测不符的数字对齐）。本任务停在 `needs-human`，由人审阅批准后才作为工作执行；执行者只改 GOAL-906 的 `title` / `body`，**不改任何 GOAL/AC 的 status，不改 AC-909 的 criterion/expect**。

### 逐字引用：当前未被覆盖的部分

**引用 1 —— GOAL 标题（逐字）**：

> AC/DoD checkbox 计数等 3 个纯判定函数收敛到 kernel/ 单一定义（4 份零共享 import 实现 → 1 份）

其中 **`（4 份零共享 import 实现 → 1 份）`** 未被 AC-909 覆盖，且与 AC-909 和实测都不一致：

- AC-909 要求 `countAcCheckboxes / stripTrailingFullWidthAnnotation / expandGlob` **各恰 1 个定义处**，即收敛后共 **3** 个定义，不是 1 个；
- HEAD 实测（`grep -rnE "function NAME\b" packages/quay/src plugin/scripts scripts --include='*.ts'`，2026-10-21 本会话实跑）是 3 个名字**各 2 份 = 6 份**：
  - countAcCheckboxes → `packages/quay/src/task-parsing.ts:117` + `plugin/scripts/task-schema.ts:431`
  - stripTrailingFullWidthAnnotation → `packages/quay/src/observation.ts:504` + `plugin/scripts/touches-parser.ts:78`
  - expandGlob → `plugin/scripts/canonical-test-files.ts:41` + `scripts/test-coverage-check.ts:122`
- 标题里的「4 份」来源于 `plugin/scripts/task-schema.ts:420` 的历史注释（checkbox 判定**历史上**曾有 4 个零共享 import 实现），不是本 goal 当前 3 个函数的现状。4→1 与 6→3 两个数字都不符，属于一段会误导充分性判官的文本。

**引用 2 —— `## 范围与非目标` 节里的一句（逐字）**：

> detect_duplicates 不再报这三组

该句未被 AC-909 覆盖：AC-909 的 `criterion` 是一条 `grep -rnE "function NAME\b"` 名字计数命令，**从不调用 archguard**；把这一句写成退出条件，AC 集将在结构上覆盖不到它。

**引用 3 —— 退出条件的缺席**：`quay goal show GOAL-906 --json` 读回的真实 body 只有 `## 背景`、`## 调查结论（机械事实 / 判断分开）`、`## 范围与非目标`、`## AC` 四节，**没有任何 `## 退出条件` 节**。

### 为什么现有 AC 集不覆盖它

1. **机械层（确定性根因）**：`plugin/scripts/goal-driver.ts:1184 goalSufficiencyVerdict()` 的第一条判断是 `if (!hasExitConditions(body)) return "insufficient"`——它**根本不看**在域 AC。所以只要 body 没有非空 `## 退出条件`，无论补多少条 AC，这个 verdict 都不可能改变。这正是本提案选 (b) 而不是 (a) 的原因：**(a) 新增 AC 在结构上改不了这一层**。
2. **标题数字**：如上，AC-909 不测量「4→1」，它测量的是「每个名字各 1」。
3. **archguard 条款**：AC-909 的判据只数定义名，不重跑 `detect_duplicates`；而且 archguard 的重复分组/阈值不受本 goal 控制，是代理量（硬规则 4b：优先直接量，不叠加未经测试的派生读数）。把它写成独立退出条件会制造一个 AC 集永远覆盖不到的条目。

### 提案：要应用的文本修订（逐字）

**(1) 标题改为**：

> AC/DoD checkbox 计数等 3 个纯判定函数收敛到 kernel/ 单一定义（3 个函数各 2 份零共享 import 实现 → 各 1 份，共 6 → 3）

**(2) 在 `## 范围与非目标` 之前新增下面这一节**（用 `goal_write` MCP 的 `body` 整体替换，注意 `quay goal write` 没有 `--body-file`）：

> ## 退出条件
>
> ① `countAcCheckboxes`、`stripTrailingFullWidthAnnotation`、`expandGlob` 三个纯判定函数在 `packages/quay/src`、`plugin/scripts`、`scripts` 三个被扫目录（`*.ts`）中各恰有 1 个 `function NAME` 定义处——按名字逐个计数，不是总数；
> ② 上述 3 个唯一定义全部落在 `packages/quay/src/kernel/`（或经 kernel/ 转发的单一真身），产品层与工具层不再各自持有本地实现；
> ③ 产品层（`packages/quay/src`）与工具层（`plugin/scripts`、`scripts`）的消费方均 import/export 该 kernel 真身；
> ④ 判据能取假：向任一层加回一份同名 `function` 定义 ⇒ 判据红并写出 cause（名字 + 实际定义数）；删除后 ⇒ 判据绿。

**(3) 把 `## 范围与非目标` 里的 `detect_duplicates 不再报这三组` 改为**：

> 验证说明（不是独立退出条件）：上述收敛在结构上意味着 archguard `detect_duplicates` 不应再报这三组；该重跑作为 Resolution 里的一条【派生观测】记录，不被写成本 goal 的退出条件——archguard 的重复分组/阈值不受本 goal 控制，是代理量（硬规则 4b）。

### 为什么提案覆盖了那个缺口

新增的 ①–④ **逐条重述 AC-909 的 `expect` 原文**（各恰 1 个定义处 / 落在 kernel/ / 消费方 import 真身 / 反向能取假），因此判官有明确、可逐条映射的目标。apply 之后：

- `goalSufficiencyVerdict(GOAL-906, [AC-909])` 由 `insufficient` 变为 `not-evaluated`（机械层不再卡死）；
- 语义判官面对的是它能逐条对上 AC-909 `expect` 的退出条件；
- 范围节里的 archguard 条款降为派生观测后，范围节不再包含一条 AC 集不覆盖的交付项。

### 审阅者决策点（不属于本提案，留给人）

AC-909 的 `criterion` 字段本身只是一条名字计数 grep；「落在 kernel/」与「消费方 import 真身」两条只写在 `expect` 里，AC 闸不会跑它们。本提案把退出条件写成与 AC-909 的 `expect` 一致（所以 AC 集覆盖退出条件），但**没有**顺势改 AC-909 的 `criterion`——那是一次 AC 修订（选项 (a)），由人决定是否另案。若人希望退出条件 ②③ 也机械可判，应把这两条断言并进 AC-909 的 `criterion`。

<!-- dedup-ref -->相关但不同：`gap-three-pure-judges-kernel-single-def`（`status: ready`，`goal_ac: AC-909`）负责三个函数的代码收敛本身；它不提议改 AC 集或退出条件，与本提案不是重复。本提案只改 GOAL-906 的 goal body 文本。

**不做什么**：不写 goal store（本任务处于 `needs-human`，批准后才执行 apply）；不改 AC-909 的 status/`criterion`/`expect`；不改任何代码或测试。

## AC

- [ ] AC1 机械充分性闸在真实 goal 载体上翻转：`node packages/quay/bin/quay.js goal show GOAL-906 --json 2>/dev/null | node --no-warnings --experimental-strip-types --input-type=module -e 'import { goalSufficiencyVerdict } from "./plugin/scripts/goal-driver.ts"; let s=""; for await (const c of process.stdin) s+=c; const g=JSON.parse(s); const v=goalSufficiencyVerdict(g,[{id:"AC-909"}]); console.log("verdict="+v); if (v==="insufficient") process.exit(1);'` 退出 0，stdout 为 `verdict=not-evaluated`（⛔ 不是 `verdict=insufficient`）。
- [ ] AC2 退出条件节非空且恰有 4 条编号条款：在同一条 `goal show GOAL-906 --json` 读数上运行 `node -e`，断言 body 的 `## 退出条件` 节体非空白字符 > 40、`/^[①②③④]/gm` 命中恰 4 行、每条非空白字符 ≥ 20；退出 0 并打印 `clauses=4`。
- [ ] AC3 标题不再声称 4→1：同一条读数中 `title` 不含子串 `4 份零共享`，且含子串 `6 → 3`；退出 0。
- [ ] AC4 范围文本不再把 archguard 重跑写成独立交付项：同一条读数中 body 不含子串 `detect_duplicates 不再报这三组`，且含 `派生观测` 与 `不是独立退出条件`；退出 0。
- [ ] AC5 判据能取假（两次读数原样贴进 Resolution）：① 对**不含** `## 退出条件` 的合成 body（`"## 背景\n\nx"`）调用 `goalSufficiencyVerdict({id:"GOAL-906",body},[{id:"AC-909"}])` ⇒ `insufficient`；② 对 AC1 读到的**真实** post-edit body 调用同一函数 ⇒ `not-evaluated`。两次都贴出命令与输出。
- [ ] AC6 只改 body/title：`git diff --name-only $(git merge-base HEAD develop) -- goals/` 的输出恰好只有 `goals/GOAL-906-ac-dod-checkbox-计数等-3-个纯判定函数收敛到-kernel-单一定义-4-份零共享-import-实现.md` 一行（AC-909 文件未动），且 `quay goal show GOAL-906 --json` 的 `status` 仍为 `active`。

## DoD

在 landed 提交上，goal store 的真实载体（`quay goal show GOAL-906 --json` 读回，而不是只贴源码/文件片段）已带非空 `## 退出条件` ①–④，且 `goalSufficiencyVerdict(GOAL-906,[AC-909])` 实跑读数为 `not-evaluated`；标题已由 4→1 改为 6→3，`detect_duplicates 不再报这三组` 已降为派生观测。Resolution 里贴出：AC1 的真实载体读数、AC5 的红/绿两次读数、`git diff --name-only $(git merge-base HEAD develop) -- goals/` 的单文件证据、以及 AC-909 仍为 `active` 且其 criterion/expect 未改动的证据。任务体 `## Touches` 与实际改动一致（多改/少改都在 Resolution 说明）。

## Touches

- goals/GOAL-906-ac-dod-checkbox-计数等-3-个纯判定函数收敛到-kernel-单一定义-4-份零共享-import-实现.md
- tasks/gap-goal906-add-exit-conditions.md

---
id: gap-goal907-add-exit-conditions
title: "GOAL-907 缺 ## 退出条件 致充分性闸永久 insufficient：补写 4 条退出条件并把「棘轮」条款降为手段"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**这是一份提案，不直接改 goal store。** 提案类型 = 选项 (b)：为 GOAL-907 补写缺失的 `## 退出条件` 节（并把 `## 范围与非目标` 里作为防回归手段的棘轮条款标注为「不是独立退出条件」）。本任务停在 `needs-human`，由人审阅批准后才作为工作执行；执行者只改 GOAL-907 的 body，**不改任何 GOAL/AC 的 status，不改 AC-911 的 criterion/expect**。

### 逐字引用：当前未被覆盖的部分

**引用 1 —— 退出条件的缺席（本提案的名称对象）**：`node packages/quay/bin/quay.js goal show GOAL-907 --json` 读回的真实 body 只有 `## 背景`、`## 调查结论（机械事实 / 判断分开）`、`## 范围与非目标`、`## AC` 四节，**没有任何 `## 退出条件` 节**。充分性判官看到的退出条件文本是空串。

**引用 2 —— GOAL 标题（逐字）**：

> 完成 src→core 迁移：删 10 个内部 shim，只留 abi.ts 与 config.ts 公开面（shim 12→2）

其中 **「删 10 个内部 shim」** 这一半没有被 AC-911 的**可跑判据**覆盖：AC-911 的 criterion 只数「带 `FORWARDING re-export` 头注释的文件数 == 2」。一棵把 10 个 shim 的头注释删掉、文件仍留在原处继续转发的树，同一判据读数仍为 2 ⇒ 绿，但标题声称的「删 10 个内部 shim」并未发生。这半句只写在 AC-911 的 `expect` 散文里（逐字：「其余 10 个（adr-store/branch-model/contract-validator/criterion-fidelity/document-store/frontmatter-store-base/goal-store/plugin-root/store-commit/worktree-namespace）已删且消费方改指 core/」），不在可跑判据里。

**引用 3 —— `## 范围与非目标` 的 `范围：` 一句（逐字）**：

> 范围：删 10 个内部 shim；消费方改指 core/；import-graph-check 加「import 已删 src 根 shim = 违规」棘轮。

其中「import-graph-check 加…棘轮」是**防回归手段**，不是终态。把它当独立交付项写进退出条件，会让 AC 集结构上永远覆盖不到它（AC-911 不读 import-graph-check）。

### 为什么现有 AC 集不覆盖它

1. **机械层（确定性根因）**：`plugin/scripts/goal-driver.ts` 的 `goalSufficiencyVerdict()` 第一条判断是 `if (!hasExitConditions(body)) return "insufficient"`——它**根本不看**在域 AC。所以只要 body 没有非空 `## 退出条件`，补多少条 AC 都不可能改变这个 verdict。这正是本提案选 (b) 而不是 (a) 的原因：**(a) 新增 AC 在结构上改不了这一层**。
2. **本会话实测（2026-10-21，cwd=git 根）**：`goalSufficiencyVerdict(GOAL-907, [AC-911])` 现读数 = `insufficient`；在同一 body 上插入本提案的退出条件节后，同一函数读数 = `not-evaluated`（两次读数见下「提案覆盖」节，命令与输出原样可复跑）。
3. **AC-911 的测量边界**：它的 criterion 只数文件头注释个数，既不测量「10 个具名文件确实从树里消失」，也不测量「消费方不再指向这些路径」——后两条只存在于它的 `expect` 散文里（硬规则 4：散文会被改写掉）。

### 提案：要应用的文本修订（逐字）

**(1) 在 `## AC` 之前新增下面这一节**（用 `goal_write` MCP 的 `body` 整体替换；`quay goal write` 没有 `--body-file`）：

> ## 退出条件
>
> ① `packages/quay/src` 根下带 `FORWARDING re-export` 头注释的文件恰为 2 个，且逐字就是公开 ABI 面 `abi.ts` 与 `config.ts`；
> ② 其余 10 个内部 shim（adr-store / branch-model / contract-validator / criterion-fidelity / document-store / frontmatter-store-base / goal-store / plugin-root / store-commit / worktree-namespace）已从树中删除，且没有任何代码路径（静态 import / `export … from` / 动态 import / 以 shim 路径 spawn）再指向这些 src 根路径——消费方全部指向 `packages/quay/src/core/<name>.ts`；
> ③ 判据能取假：保留第 3 个带该头注释的 shim ⇒ AC-911 判据红并写出实际计数；删至 2 ⇒ 绿；
> ④ AC-911 achieved。

**(2) 把 `## 范围与非目标` 的 `范围：` 一句改为**：

> 范围：删 10 个内部 shim；消费方改指 core/；import-graph-check 加「import 已删 src 根 shim = 违规」棘轮（手段 / 防回归，不是独立退出条件——退出条件只写终态）。

**(3) 标题不动**：标题里的「12→2」与实测一致（本会话 `grep -rln 'FORWARDING re-export' packages/quay/src/*.ts | wc -l` 读数 = **12**），没有 GOAL-906 那种「标题数字与实测不符」的问题，不需要改。

### 为什么提案覆盖了那个缺口

- 退出条件 ① 逐字复述 AC-911 `expect` 的正向半句（「恰剩 2 个（abi.ts 与 config.ts，公开 ABI 面）」）；② 逐字复述它的「其余 10 个（…）已删且消费方改指 core/」；③ 复述它的反向控制句；④ 写明 goal→AC 的达成关系。判官因此有逐条可映射到唯一在域 AC 的目标，而不是面对一段无 AC 可对的终态描述。
- 范围节里的棘轮降为「手段 / 防回归」后，范围节不再包含一条 AC 集不覆盖的**交付项**；棘轮本身仍由执行任务 `gap-ac911-src-root-forwarding-shim-deletion` 实现（它的 AC 里有 `import-graph-check --json` 的 `retiredShimHits` 读数与双向夹具）。
- 机械层由 `insufficient` 翻成 `not-evaluated`，本会话已实测：
  - `before=insufficient`（真实 GOAL-907 body + `[{id:"AC-911"}]`）
  - `after=not-evaluated`（同 body 在 `## AC` 前插入上面 ①–④ 后）

### 审阅者决策点（不属于本提案，留给人）

- 在 AC-911 的 criterion 不改的前提下，「删 10 个内部 shim」与「消费方改指 core/」只是退出条件层面的散文覆盖，AC 闸不会跑它们。若人希望它们**机械可判**，需要一次 AC 修订（选项 (a)：例如把「10 个具名路径在 `git ls-files` 中不存在 ∧ 无非注释 import/spawn 指向它们」并进 AC-911 的 criterion，或另立一条 AC）——本提案不顺势改 AC-911。
- 「不改任何行为」留在 `非目标` 里，不写成退出条件：goal 级 AC 集里没有任何一条读 suite / 运行时行为，写成退出条件会让它结构上不可覆盖；它由执行任务的 scoped gate + 全量 suite 覆盖。

<!-- dedup-ref -->相关但不同：`gap-ac911-src-root-forwarding-shim-deletion`（status: ready，goal_ac: AC-911）负责删 shim 的代码工作本身，它不提议改 AC 集或退出条件，与本提案不是重复。另：`gap-goal906-add-exit-conditions` 是同一机制在 GOAL-906 上的先例（status: needs-human），本任务沿用其结构。

**不做什么**：不写 goal store（批准后才 apply）；不改 AC-911 的 status / criterion / expect；不改任何代码或测试。

## AC

- [ ] AC1 机械充分性闸在真实 goal 载体上翻转：`node packages/quay/bin/quay.js goal show GOAL-907 --json 2>/dev/null | node --no-warnings --experimental-strip-types --input-type=module -e 'import { goalSufficiencyVerdict } from "./plugin/scripts/goal-driver.ts"; let s=""; for await (const c of process.stdin) s+=c; const g=JSON.parse(s); const v=goalSufficiencyVerdict(g,[{id:"AC-911"}]); console.log("verdict="+v); if (v==="insufficient") process.exit(1);'` 退出 0，stdout 为 `verdict=not-evaluated`（⛔ 不是 `verdict=insufficient`）。
- [ ] AC2 退出条件节非空且恰有 4 条编号条款：在同一条 `goal show GOAL-907 --json` 读数上运行 `node -e`，断言 body 的 `## 退出条件` 节体非空白字符 > 40、`/^[①②③④]/gm` 命中恰 4 行、每条非空白字符 ≥ 20；退出 0 并打印 `clauses=4`。
- [ ] AC3 棘轮条款已降为手段：同一读数中 body 含子串 `不是独立退出条件`，且该子串所在行仍以 `范围：` 开头（棘轮仍是范围内要做的实现动作，只是不再是退出条件）。
- [ ] AC4 判据能取假（两次读数原样贴进 Resolution）：① 对**不含** `## 退出条件` 的合成 body（`"## 背景\n\nx"`）调用 `goalSufficiencyVerdict({id:"GOAL-907",body},[{id:"AC-911"}])` ⇒ `insufficient`；② 对 AC1 读到的**真实** post-edit body 调用同一函数 ⇒ `not-evaluated`。两次都贴出命令与输出。
- [ ] AC5 只改 body：`git diff --name-only $(git merge-base HEAD develop) -- goals/` 的输出恰好只有 `goals/GOAL-907-完成-src-core-迁移-删-10-个内部-shim-只留-abi-ts-与-config-ts-公开面-shim.md` 一行（AC-911 文件未动），且 `quay goal show GOAL-907 --json` 的 `status` 仍为 `active`；`quay goal show AC-911 --json` 的 `status` 仍为 `active`、`criterion`/`expect` 与 apply 前逐字节相同。

## DoD

在 landed 提交上，goal store 的真实载体（`quay goal show GOAL-907 --json` 读回，而不是只贴源码/文件片段）已带非空 `## 退出条件` ①–④，且 `goalSufficiencyVerdict(GOAL-907,[AC-911])` 实跑读数为 `not-evaluated`；`范围：` 句里的 import-graph-check 棘轮已明确标注为「手段 / 防回归，不是独立退出条件」。Resolution 里贴出：AC1 的真实载体读数、AC4 的红/绿两次读数、AC5 的 `git diff --name-only` 单文件证据、以及 AC-911 仍为 `active` 且其 criterion/expect 未改动的证据。任务体 `## Touches` 与实际改动一致（多改/少改都在 Resolution 说明）。

## Touches

- goals/GOAL-907-完成-src-core-迁移-删-10-个内部-shim-只留-abi-ts-与-config-ts-公开面-shim.md
- tasks/gap-goal907-add-exit-conditions.md
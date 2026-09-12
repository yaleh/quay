---
id: gap-goal-sufficiency-judges-wrong-layer-and-emits-unverifiable-verdict
title: sufficiency judge 判的是「AC ⊇ 退出条件」而非「退出条件 ⊨ 业务目标」，且输出是不可复核的判决
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-driver-blind-to-driven-system-health
---
## Proposal

**症状一：提问层次差一层（2026-09-12 实测）**。`goalSufficiencyVerdict`（`plugin/scripts/goal-driver.ts:613-619`）的机械部分只做两个结构检查：

```typescript
if (!hasExitConditions(String(goal.body ?? ""))) return "insufficient";
if (inScopeAcs.length === 0) return "insufficient";
return "not-evaluated";   // 其余交语义 judge
```

语义 judge 的 prompt（`:663`）逐字：`"Decide whether the goal's in-scope AC set fully covers its exit conditions."`

⇒ **它判的是 `AC ⊇ 退出条件`**。GOAL-016 判 `covered` **是对的**——四条 AC 确实逐条覆盖了正文写下的退出条件。

**但同日人工审计给出相反结论**：GOAL-016 的 AC 集对其**业务目标**（quay 能否自主、可重复地驱动第三方项目开发）**不充分**——样本量 = 1、从未验证失败拦截、**没有任何 AC 约束人介入次数**（该审计已写入 GOAL-016 正文的「scope 审计」节）。

⇒ **⛔ 不是判错，是没有任何机制在问上一层**：「退出条件本身 ⊨ 业务目标吗」。

**症状二：输出不可复核**。它只吐 `"covered"` / `"insufficient"` 一个判决。而**语义判断天然产出「能解释的说法」**，本仓库硬规则推论四逐字规定：**一个能【解释】现象的说法，不是一个被【检验】的结论**。⇒ 一个不带指认的语义判决，任何人都无法机械复核。

**「带指认才有用」已有同日实证**：AC-234（GOAL-015，已 achieved，判据要求 `round_records_rendered > 0`）的**三条证据 `project_root` 全部匹配 `quay-verify-coldstart-*-root`**（`quay-init` 造的一次性项目，天然带 quay 自身形状），无一条来自带自有 suite 入口的真实第三方项目 ⇒ 该 AC 的绿**不覆盖真实形态**。**这个结论的成立方式是：语义提出可疑处 → 机械验证模式匹配。** 若 sufficiency judge 当初输出的是带这种指认的结论，它本可以早被发现。

## Plan

1. **加一层提问**：除「AC ⊇ 退出条件」外，另问「退出条件 ⊨ goal 的业务目标」，两层结论**分别输出**（⛔ 不要合并成一个判决）。
2. **喂证据来源**：把**已达成 AC 的载体记录**（`host` / `project_root` 等）一并作为 judge 输入——没有这个输入，它结构上看不见「证据同质」。
3. **输出形态改为「判决 + 可机械复核的指认」**：判 `insufficient` 时必须给出一条**能被一条命令验证**的具体断言（形如「AC-x/y/z 的证据 `project_root` 全部匹配 `<pattern>`」）。
4. **负控制**：指认缺失或不可复核时 ⇒ 输出 `not-evaluated`，**⛔ 绝不默认 `covered`**（那会回到硬规则 3b：读不懂伪装成合格）。

## Acceptance Criteria

- [x] AC1 两层可区分：对 GOAL-016（退出条件层充分、业务目标层不充分）必须给出**两个可区分的结论**；贴出实际输出。
- [x] AC2 指认可复核：`insufficient` 的输出含一条断言，且该断言**能被一条命令验证**——贴出命令与其输出。
- [x] AC3 ⛔ 不默认 covered：注入一个**无指认**的 `insufficient` 输出 ⇒ 结果必须是 `not-evaluated`，⛔ 不是 `covered` 也不是 `insufficient`。
- [x] AC4 证据来源真的被消费：改变输入的载体记录**会改变结论**（⛔ 仅证明「参数被读到」不算——那与「读到但没用」同形）。

## Definition of Done

- 四条 AC 满足，AC2 的指认有实际验证命令与输出留档。
- ⛔ 不得因加了新提问层而让原「AC ⊇ 退出条件」判定退化（贴出改前/改后对同一 goal 的该层结论，须一致）。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## 与前置任务的关系

`depends_on: gap-goal-driver-blind-to-driven-system-health`。**两条理由，第一条是真实技术依赖、第二条是调度事实，⛔ 不含糊其辞**：
①（弱依赖）前置任务引入的「被驱动系统健康度」读数可作为本任务第 2 步的输入之一；
②（硬事实）两条任务的 `## Touches` 都含 `plugin/scripts/goal-driver.ts`，touches 锁使其**必然串行**——显式声明依赖只是把这个既成顺序写明，⛔ 不是为了避免冲突而编造的依赖。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-sufficiency-judges-wrong-layer-and-emits-unverifiable-verdict.md

## Evidence

**落地形态**：第二层是**一条并列的 fact**（`name="goal-objective"`，`value.objective={goal,verdict,cause?,assertion?,profile}`），
与第一层的 `goal-sufficiency` 并列，⛔ **不合并**、⛔ **不接进 `goalFlipDecision`**（第一层闸门语义逐字保留）。
实现落点 `plugin/scripts/goal-driver.ts`：`collectObjectiveEvidence` / `objectiveEvidenceProfile` /
`verifyObjectiveAssertion` / `objectiveAssertionCommand` / `buildObjectivePrompt` / `parseObjectiveJudge` /
`adjudicateObjectiveJudgment` / `objectiveSufficiencyVerdictDetail`（含确定性缓存与 `no-evidence-records` /
`assertion-missing` / `assertion-unverifiable` / `samples-disagree` / `judge-unavailable` / `judge-unparseable`
六种可区分成因，⛔ 六种都仍是 `not-evaluated`）。

**AC1（两层可区分；真 LLM 判定器 + 生产数据 `goals/GOAL-016`）** —— 第一层 `covered`、第二层 `unsubstantiated`：

```
$ node --no-warnings --experimental-strip-types /tmp/goal016-objective-probe.mjs
=== 第一层（AC ⊇ 退出条件）机械部分 ===
goalSufficiencyVerdict = not-evaluated
第一层语义判决 = {"verdict":"covered","cause":null}
=== 第二层（退出条件 ⊨ 业务目标）证据 ===
achieved ACs = ["AC-247","AC-248","AC-249","AC-250"]
evidence records = 4
=== 第二层判决（真 LLM 判定器）===
{"verdict":"unsubstantiated","cause":null,
 "assertion":{"kind":"single-value-field","field":"project_root","value":"/home/yale/work/archguard",
  "acs":["GOAL-016-AC-247","GOAL-016-AC-248","GOAL-016-AC-249","GOAL-016-AC-250"],
  "carriers":[".quay/productization-verification.jsonl"],"matched":4,"total":4,"command":"python3 -c '…'"},
 "profile":{"records":4,"distinctProjectRoots":["/home/yale/work/archguard"],
  "distinctHosts":["instance-20221019-1509"],"distinctTasks":["TASK-88","TASK-89"]}}
```

**AC2（指认可复核）** —— 指认自带的那条命令逐字跑（在仓库根），全中 exit 0；换值即 exit 1：

```
$ cd /home/yale/work/quay && python3 -c 'import json,re;acs=set(["AC-247","AC-248","AC-249","AC-250"]);carriers=[".quay/productization-verification.jsonl"];…'
matched=4 total=4
exit=0
$ # 负控制（把指认的值换成 /home/yale/work/archguard-OTHER，其余逐字不变）
matched=0 total=4
exit=1
```

**AC3（⛔ 不默认 covered）** —— 注入「`unsubstantiated` 但**无指认**」的判定器输出 ⇒ `not-evaluated`：
`plugin/test/goal-driver.test.mjs` 的 `AC3: 无指认的 unsubstantiated ⇒ not-evaluated` 断言
`verdict==="not-evaluated"` ∧ `cause==="assertion-missing"` ∧ `assertion===null` ∧ **显式排除**
`substantiated`/`unsubstantiated` 两态；另有「值与记录不符 / 字段在词表外 / 断言本身为假」三例 ⇒
`assertion-unverifiable`，以及不可用 / 读不懂 / 两次不一致 ⇒ 各自的 `not-evaluated` 成因。
**用词说明（照实记账）**：第二层的否定态取 `unsubstantiated`，⛔ 不与第一层的 `insufficient` 同形
——这正是 AC1 要求的「两层可区分」，AC3 的「⛔ 不是 `covered` 也不是 `insufficient`」由 `not-evaluated` 满足。

**AC4（证据真的被消费）** —— 同一 goal、**同一判定器输出**，只改载体记录：

```
A：2 条记录同源（project_root 全为 /p/one）        ⇒ unsubstantiated（指认成立）
B：再加 1 条 project_root=/p/two 的记录（其余相同） ⇒ not-evaluated(cause=assertion-unverifiable)
```

即结论**随载体记录改变**，且 `objectiveCacheKey` 把证据记录写进 key（记录一变必重判，⛔ 不拿旧证据下的裁决继续用）；
零证据（含「载体里只有**别的** GOAL 的记录」）⇒ `not-evaluated(no-evidence-records)`，⛔ 判定器说 `substantiated` 也不采信。
`verifyObjectiveAssertion` 的空集分支显式判**不通过**（硬规则 4：空集上的全称命题恒真，不是测量）。

**DoD（第一层不退化）** —— 改前/改后对 GOAL-016 的**第一层**结论一致，均为 `covered`：
改前取自生产轮记录 `.quay/goal-round.jsonl` 中该 GOAL 的 `value.sufficiency.verdict`
（末 5 轮 `2026-09-12T13:31:04Z / 13:33:03Z / 13:35:28Z / 13:39:17Z / 13:41:52Z` 全部 `covered`），
改后同输入仍 `covered`（见 AC1 输出）。`goal-sufficiency` fact 的键形与取值词表**未被触碰**，
新层另起一条 fact（⛔ 两条 fact 互不含对方的键，单测断言）。

**闸门**：`bash scripts/test.sh --for-task <id> --allow-thin` 退出码 0（0 个 `✖`）；
`plugin/scripts/goal-driver-task-boundary-check.ts`（DIR-131）PASS —— 新代码不读本仓自身落地率载体
（读的是 `.quay/productization-verification.jsonl` 这类 AC 证据载体）。

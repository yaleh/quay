---
id: gap-sufficiency-cache-in-memory-only-and-not-evaluated-cause-not-distinguishable
title: 充分性缓存只在内存里（driver 重启即清空 ⇒ 跨重启仍抽签），且 not-evaluated 不区分成因 ⇒ 分不清守卫在工作还是 LLM
  在失败，并使「连续 N 轮同裁决」可被恒 not-evaluated 空转满足
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-sufficiency-verdict-nondeterministic-on-identical-input
---
## Proposal

**前置成果（本条建立在它之上）**：`gap-sufficiency-verdict-nondeterministic-on-identical-input` 已 done 落 develop（`b03eb410f`「input-hash cache + 2-sample consistency guard」），消除了「同一输入给出 covered/insufficient 两种相反裁决」这个最坏形态。本条治它留下的两个口子。

### ① 缓存只在内存里 ⇒ driver 重启即清空 ⇒ 跨重启仍会重新抽签

位置判定（`git show develop:plugin/scripts/goal-driver.ts`）：

```
:441  export function sufficiencyCacheKey(...)
:458  const sufficiencyCache = new Map<string, SufficiencyVerdict>();   ← 模块级内存 Map
:462  sufficiencyCache.clear();                                          ← 测试缝
:466  export function sufficiencyCacheSnapshot(): ReadonlyMap<...>
```

**没有任何落盘**（`.quay/` 下无对应缓存文件，实测 `ls .quay/ | grep -i suffic` 只命中该任务自己的 fan-in/suite 日志）。⇒ 缓存的生命期 = goal-driver 单个进程的生命期。

**实测该进程确实会重启**：`b03eb410f` 落 develop 后 goal-driver 重新加载代码，`goal-round.jsonl` 的 `round` 从 168 归到 **1**（2026-09-10T23:5xZ）——重启是常态，不是异常。

⇒ 前置任务的 DoD 逐字要求「同一输入在**任意多轮**里给出同一充分性裁决（`goalAchieved` 不再随轮次抽签）」。**在单个进程内成立，跨重启不成立**：重启后对同一输入重新取样，仍可能得到与重启前不同的裁决 ⇒ `goalAchieved` 仍可能随「你在哪一次进程里看」而翻转。这与原缺陷同形，只是周期从「每轮」变成「每次重启」。

### ② `not-evaluated` 不区分成因 ⇒ 分不清守卫在工作还是判定器在失败

轮记录里该 Fact 的全部内容（实测 round 2 逐字）：

```
value: {"sufficiency": {"goal": "GOAL-009", "verdict": "not-evaluated"}}
state: verified | reason: sufficiency=not-evaluated（在域 AC 9 条）
```

只有 `verdict`，**没有成因**。而 `not-evaluated` 至少覆盖三种互不相同的情况：

1. **两次取样不一致** —— 新守卫在正确工作（诚实报判不出，⛔ 不掷硬币），**这是好消息**；
2. **LLM 不可用 / 超时** —— 环境问题，与判据内容无关；
3. **缓存未命中且调用失败** —— 同 2 的一个子形态。

⇒ 看到 `not-evaluated` 的人**无法区分「机制在如实报告一个真实的语义分歧」与「判定器根本没跑起来」**。这正是 `cause-carrier-must-be-distinguishable` 与硬规则③（枚举，不布尔）要防的形态：把多个不同成因写成同一个取值。

**实测背景（不作为立案依据，只说明它不是假想）**：重启后连续 2 轮 GOAL-009 均为 `not-evaluated`，而同轮 GOAL-015 稳定 `covered`。⛔ 2 轮不足以判定成因——**这恰恰就是本条要解决的问题：载体没给我区分它的手段**。

### ③ 由 ② 派生的一个更硬的后果：前置任务自己的 AC6 可被空转满足

前置任务的 AC6 逐字要求「落地后连续 ≥10 轮，同一 goal 在其在域 AC 集合未变的前提下裁决**全部相同**」。**一个恒 `not-evaluated` 的判定器完全满足「全部相同」**——它会让 AC6 转绿，而实际上什么也没证明（硬规则 4：结构上不可能取假的量不是测量；硬规则 3b：判不出不得与合格同形）。

该 AC6 目前是 `- [ ]` 且标注 `（待外部）`（worker 诚实未勾，⛔ 本条不指责前置任务），但它挂在一条已 **done** 的任务上 ⇒ 若无人收口，它要么被遗忘、要么将来被一个恒 not-evaluated 的读数轻易勾掉。

## Plan

1. **缓存落盘**：把 `sufficiencyCache` 持久化到 `.quay/` 下的载体（key = 现有 `sufficiencyCacheKey` 的输入哈希，value = 已确定的裁决 + 写入时刻）。进程启动时加载，命中即用。⛔ 仍只缓存**已确定**的裁决——`not-evaluated` 不入缓存（保持现有 fail-closed 语义，硬规则 3b）。
2. **`not-evaluated` 拆成可区分的成因**：在 Fact 的 `value.sufficiency` 里加一个成因字段（如 `cause: "samples-disagree" | "judge-unavailable" | "judge-unparseable"`），并让 `reason` 文本带上它。⛔ 不新增第四种「合格」态——三种成因都仍然是 `not-evaluated`，只是**可区分**。
3. **收口前置任务的 AC6**：把它改写成**不能被恒 not-evaluated 满足**的形态——例如「连续 ≥10 轮裁决全部相同 **且该裁决 ∈ {covered, insufficient}**」；或另加一条「若这 10 轮均为 not-evaluated，则须贴出其 `cause` 字段并说明为何该成因是真实的」。⛔ 不得直接勾掉它。

## Acceptance Criteria

- [ ] AC1 缺陷存证（改前读数）：贴 `goal-driver.ts:458` 的 `const sufficiencyCache = new Map(...)` 原文、`ls .quay/ | grep -i suffic` 的无缓存文件输出，以及一条 round 记录里只含 `verdict` 的 `goal-sufficiency` Fact 原文。
- [ ] AC2 缓存跨重启存活（直接量，能取假）：对同一输入取得一次**已确定**裁决 ⇒ 重启 goal-driver ⇒ 下一轮该 goal 的裁决与重启前**相同**，且该轮**未 spawn 判定器**（贴 LLM 调用计数为 0 的读数）。负控制：清空缓存载体后重启 ⇒ 调用计数 +1。贴两次的 (裁决, 调用计数)。
- [ ] AC3 `not-evaluated` 成因可区分（三方向各一次实测）：分别构造「两次取样不一致」「判定器不可用」「输出不可解析」，轮记录里 `cause` 三个取值互不相同；贴三条 Fact 原文。⛔ 三者不得共用同一取值。
- [ ] AC4 成因不改变判定语义：三种成因下 `verdict` 仍为 `not-evaluated`，`goalAchieved` 仍为 false；贴三次 `goalAchieved` 读数。⛔ 不得借成因字段放行。
- [ ] AC5 前置任务 AC6 已收口：`tasks/gap-sufficiency-verdict-nondeterministic-on-identical-input.md` 的 AC6 文本已改为不能被恒 `not-evaluated` 满足的形态；贴改前改后两段原文，并说明新形态为何能取假。
- [ ] AC6 生产载体验证（⛔ 夹具不算）：改动落地后取连续 ≥10 轮 `goal-round.jsonl`，同一 goal 在其在域 AC 集合未变的前提下裁决全部相同**且该裁决 ∈ {covered, insufficient}**；若这 10 轮确为 not-evaluated，则贴出其 `cause` 并说明该成因真实存在（此时本 AC 不算达成，须继续观察）。
- [ ] AC7 单测：扩 `plugin/test/goal-sufficiency-determinism.test.mjs`，覆盖 AC2（跨重启）与 AC3（三成因）；`node --test` exit 0。
- [ ] AC8 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

充分性裁决对同一输入**跨 goal-driver 重启**仍保持同一取值（缓存落盘且启动时加载），`not-evaluated` 的三种成因在生产载体里可区分，且前置任务的 AC6 已改写为不能被恒 `not-evaluated` 空转满足的形态。⛔ 把 `not-evaluated` 折叠进 `covered`、或让成因字段影响 `goalAchieved` ⇒ 不算达成；⛔ 只加成因字段而不落盘缓存 ⇒ 只完成一半（跨重启抽签仍在）。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-sufficiency-determinism.test.mjs
- tasks/gap-sufficiency-verdict-nondeterministic-on-identical-input.md
- tasks/gap-sufficiency-cache-in-memory-only-and-not-evaluated-cause-not-distinguishable.md

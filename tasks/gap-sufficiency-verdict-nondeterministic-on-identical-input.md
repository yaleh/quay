---
id: gap-sufficiency-verdict-nondeterministic-on-identical-input
title: 充分性裁决对同一输入不确定：12 轮逐字相同的输入产出 covered/insufficient/not-evaluated 三种结果，而
  goalAchieved 与它是合取 ⇒ 目标算不算达成取决于看的是哪一轮
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**判据的输入没变，裁决变了——对照已做，不是解释（硬规则 4 推论四）**。

`.quay/goal-round.jsonl` 第 130–141 轮（2026-09-10T21:56:20Z → 22:42:06Z，46 分钟），GOAL-009 的在域 AC 集合**逐字相同**（`AC-201,202,203,204,205,206,207,214,232`），且该窗内 `goals/GOAL-009*.md` 与这 9 条 AC 记录**一次提交都没有**（`git log --since` 两次查询均为空）⇒ 送进 `buildSufficiencyPrompt` 的 prompt 逐字相同。裁决却是：

```
130 not-evaluated    134 covered         138 not-evaluated
131 covered          135 insufficient    139 covered
132 covered          136 covered         140 covered
133 not-evaluated    137 covered         141 not-evaluated
```

同一输入：**covered ×6、insufficient ×1、not-evaluated ×4**（另 1 轮无记录）。`insufficient` 与 `covered` 是**语义相反**的裁决，不是「判不出」——⇒ 判定本身不确定。

**为什么这是硬阻塞而不是噪声**：`plugin/scripts/goal-driver.ts:353` 逐字
```
return goalAchievedFromRecords(records, goalId) && sufficiency?.verdict === "covered";
```
是合取式。⇒ **一个目标算不算达成，取决于恰好在哪一轮做的判定**。这与硬规则 4 同源：一个取值依赖轮次抽签的量，不能作为达成判据。

**全历史发生率（硬规则 12b：查历史，非窄窗）**——`goal-round.jsonl` 全量解析：

| goal | covered | insufficient | not-evaluated | not-evaluated 占比 |
|---|---|---|---|---|
| GOAL-009 | 272 | 30 | 244 | **44.9%** |
| GOAL-010 | 2 | 0 | 169 | **98.8%** |
| GOAL-011 | 1 | 180 | 170 | 48.4% |
| GOAL-012（**已 achieved**） | 30 | 5 | 5 | 12.5% |
| GOAL-013 | 36 | 12 | 10 | 17.2% |
| GOAL-015 | 3 | 116 | 4 | 3.2% |

**代价已经真实发生过一次**：GOAL-012 已被判 **achieved**，而它历史上有 **5 轮 insufficient**——那次达成裁定落在了一个 `covered` 轮上。⛔ 本任务**不主张 GOAL-012 的达成是错的**（它的 5 条 AC 判据都独立复核过 exit 0）；只指出**这个决定的一半是抽签**，同样的抽签下一次可能反过来挡住一个真该达成的目标，或放过一个不该达成的。

**与既有三条 sufficiency 任务的关系（均 done，都不覆盖本机制）**：
- `gap-goal-sufficiency-gate`（AC-212）——建了闸本身；
- `gap-goal-sufficiency-semantic-covered`（AC-222）——使它**能**产出 `covered`（否则「防假达成」变成「永不达成」）；
- `gap-goal-sufficiency-not-evaluated`（AC-213）——使 `not-evaluated` 成为独立取值且不触发 flip。

三条各自都对，**但没有一条问过「同一输入是否给同一裁决」**。⇒ 本条是第四个、正交的性质：**输入稳定性**。

## Plan

**要的性质是「对输入确定」，不是「总是 covered」。** 推荐做法（实现者可换等效方案，但必须满足下面的 AC）：

1. **按输入哈希缓存裁决**：key = `hash(goal.body 的退出条件段 ‖ 在域 AC 的 (id, title, expect) 有序列表)`——即 `buildSufficiencyPrompt` 的全部输入。命中即直接返回缓存值，⛔ 不重问 LLM。任一 AC 的 expect / goal 退出条件改动 ⇒ 哈希变 ⇒ 自动重判。
2. **首次判定要 2 次一致才入缓存**（防把一次抽签结果latch 成永久答案）：两次取样不一致 ⇒ 记 `not-evaluated` 并留痕，下一轮再试；⛔ 不取多数票（那仍是概率判定，且更贵）。
3. **⛔ 缓存不得把「判不出」变成「合格」**（硬规则 3b）：缓存未命中 ∧ LLM 不可用 ⇒ 仍返回 `not-evaluated`，与今天的行为一致。缓存只对**已确定的输入**生效。
4. **顺带收益（不是目标，但应度量）**：GOAL-009 单条就有 546 次判定，其中 244 次判不出。按输入哈希缓存后，稳定期每个 goal 每轮应为 0 次 LLM spawn——`semanticSufficiencyVerdict` 的超时上限是 `SUFFICIENCY_TIMEOUT_MS`，这些 spawn 同时也是 goal 轮时长的主要成分。

## Acceptance Criteria

- [ ] AC1 缺陷存证（改前读数）：贴出第 130–141 轮的「在域 AC 集合 + 裁决」对照表（本文正文那张），并贴两条 `git log --since` 为空的输出，证明输入未变。
- [ ] AC2 确定性（正向，能取假）：对**同一固定输入**连续调用判定 5 次，5 次裁决完全相同；⛔ 判据不得靠 mock 掉 LLM 来达成——须走真实缓存路径（首次判定后 4 次命中缓存）。贴 5 次的返回值与「LLM 被调用了几次」的计数（应为 ≤2）。
- [ ] AC3 输入变化必重判（防缓存过期为假保证）：改动任一在域 AC 的 `expect` 一个字符 ⇒ 哈希变 ⇒ 判定重新 spawn LLM（调用计数 +1）；还原后再调 ⇒ 命中原缓存不再 spawn。贴三次的调用计数序列。
- [ ] AC4 不得把判不出变成合格（硬规则 3b，能取假）：缓存未命中 ∧ 令 LLM 调用失败/超时 ⇒ 返回 `not-evaluated`（**不是** `covered`，也**不是**沿用别的输入的缓存值）；贴该次返回值与 `goalAchieved` 仍为 false 的读数。
- [ ] AC5 首次判定的一致性守卫：注入两次**不一致**的取样（一次 covered、一次 insufficient）⇒ 本轮结果为 `not-evaluated` 且**不入缓存**；下一轮两次一致 ⇒ 入缓存。贴两轮的裁决与缓存内容。
- [ ] AC6 生产载体验证（⛔ 夹具不算，硬规则 4 推论三）：改动落地后，从 `goal-round.jsonl` 里取**落地时刻之后**连续 ≥10 轮，同一 goal 在其在域 AC 集合未变的前提下裁决**全部相同**；贴这 10 轮的 (round, 在域AC集合, 裁决) 三元组。
- [ ] AC7 单测：`node --test plugin/test/goal-sufficiency-determinism.test.mjs` exit 0，覆盖 AC2/AC3/AC4/AC5 四个方向。
- [ ] AC8 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

同一输入在任意多轮里给出同一充分性裁决（`goalAchieved` 不再随轮次抽签），且「判不出」仍与「合格」不同形、输入一变即重判。AC6 的读数取自**生产载体**而非夹具。⛔ 把 `semanticSufficiencyVerdict` 改成恒返回 `covered`、或把 `not-evaluated` 折叠进 `covered` ⇒ 不算达成（那是把一个抽签换成一个假保证，比抽签更贵）。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-sufficiency-determinism.test.mjs
- tasks/gap-sufficiency-verdict-nondeterministic-on-identical-input.md

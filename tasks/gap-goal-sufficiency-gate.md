---
id: gap-goal-sufficiency-gate
title: 充分性闸——GOAL flip 前判「退出条件被 AC 覆盖」，不足则不 flip 且 sufficiency 判定落轮记录
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-212
---
## Proposal

正本：`goals/AC-212-充分性闸挡住-ac-全绿即关闭-退出条件未被覆盖时-goal-不得自行关闭.md`。

**现状（实测，非主张）**：
- `goalAchievedFromRecords`（`plugin/scripts/goal-driver.ts:297-301`）是纯语法合取——「所有在域 AC 都 achieved ⇒ GOAL achieved」，无任何环节判过「这组 AC 若全绿，是否等于 GOAL body 里 `## 退出条件` 的达成」。
- I2 GOAL 层 flip（`goal-driver.ts:661-665`）直接调该函数；`covered`/`insufficient`/`not-evaluated` 三态词汇在驱动里不存在。
- 生产 `.quay/goal-round.jsonl` 中 `sufficiency` 记录 = 0 条（`grep -c sufficiency .quay/goal-round.jsonl` ⇒ 0），故 AC-212 判据当前取假（其 origin 已明言，期望本任务落地后一轮生产轮即转真）。
- 输入齐备：`listGoalRecords` 返回的 records 含 GOAL 的 `body`（`## 退出条件` 在其中，goal-store `list()` 的 view-model 带 body）与 AC 的 `title`/`expect`（`recordTitleOf`/`acExpectOf` 已在用），充分性判定无需新数据源。

**修法（一处源码 + 一处新测试）**：
1. `plugin/scripts/goal-driver.ts` 新增纯导出 `goalFlipDecision(records, goalId, sufficiency)`——flip 当且仅当 `goalAchievedFromRecords(records, goalId) && sufficiency?.verdict === "covered"`；`insufficient`/`not-evaluated`/`null` 一律不 flip。I2 GOAL 层 flip 改调它。
2. 同文件 `runGoalRound`：对每个 active GOAL 产出一条 sufficiency 判定（读其 body 退出条件 vs 在域 AC 集合 ⇒ `covered`/`insufficient`/`not-evaluated`），并作为独立 Fact 落进轮记录，形如 `{name:"goal-sufficiency", value:{sufficiency:{goal, verdict}}, state, reason}`——AC-212 判据 grep 的正是 `facts[].value.sufficiency`（dict，含 `goal` 与三态 `verdict`）。⛔ 判不出也要写 `not-evaluated` 并落痕，不静默丢弃（否则判据 part 1 结构上永远无法满足）。

⛔ 范围外（各自另有 AC，本任务不碰）：`not-evaluated` 与 `covered` 的取值可区分性及「not-evaluated 不触发 flip」的独立测试归 AC-213（`goal-sufficiency-not-evaluated.test.mjs`）；充分性判定的 LLM 提示词/成本上限（AC-213 与 GOAL-010 风险 2 的「判不出 ⇒ not-evaluated」共同覆盖）；`goal-store.isGoalAchieved` 的 draft 死角（`goal-driver.ts:293-294` 已标注「另案处理」）。

## AC

- [x] 新建 `plugin/test/goal-sufficiency-gate.test.mjs`：正控制「在域 AC 全 achieved + sufficiency=covered ⇒ `goalFlipDecision` true」、负控制「在域 AC 全 achieved + sufficiency=insufficient ⇒ `goalFlipDecision` false」（后者即 AC-212 判据点名的那条）；`node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-gate.test.mjs` 退出码 0
- [x] `plugin/scripts/goal-driver.ts` 导出 `goalFlipDecision` 且其 flip 条件含 `sufficiency?.verdict === "covered"`；I2 GOAL 层 flip 调用点改用 `goalFlipDecision`（`grep -n "goalFlipDecision" plugin/scripts/goal-driver.ts` 命中导出与调用点，调用点不再直调 `goalAchievedFromRecords` 判 flip）
- [x] `runGoalRound` 把 sufficiency 判定写进轮 facts（`grep -n "sufficiency" plugin/scripts/goal-driver.ts` 命中 Fact 构造落点），且 `goal-sufficiency-gate.test.mjs` 内含断言：`runGoalRound(tmp, {scriptRoot})`（复用 `goal-driver.test.mjs` 的 temp-root 缝，非 fixture 注入）返回的 facts 中存在 `value.sufficiency`（dict，含 `goal` 与三态 `verdict`）

## DoD

AC-212 完整 criterion 的两半都满足：①负控制单测证明「在域 AC 全绿但充分性判 insufficient ⇒ 不 flip GOAL」（`plugin/test/goal-sufficiency-gate.test.mjs` 退出码 0）；②生产 `.quay/goal-round.jsonl` 在本任务落地后的首轮出现 ≥1 条 `value.sufficiency`（带 goal 与三态之一，AC-212 判据的 python one-liner 退出码 0）。改动经 fan-in 落地 develop，`git show develop:plugin/scripts/goal-driver.ts` 可见 `goalFlipDecision` 与 sufficiency 记录落点。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-sufficiency-gate.test.mjs`
- `plugin/test/goal-driver.test.mjs`
- `tasks/gap-goal-sufficiency-gate.md`

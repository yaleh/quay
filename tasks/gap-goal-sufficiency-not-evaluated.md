---
id: gap-goal-sufficiency-not-evaluated
title: 充分性判不出 ≠ 通过——not-evaluated 是独立取值且不触发 flip（硬规则 3b）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-sufficiency-gate
goal_ac: AC-213
---
## Proposal

正本：`goal_get AC-213`（GOAL-010 名下 criterion），判据 = `node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-not-evaluated.test.mjs`。

**现状（实测，非主张）**：
- `plugin/scripts/goal-driver.ts` 此刻尚无 `goalFlipDecision`、也无 sufficiency 三态落轮记录——由 sibling `gap-goal-sufficiency-gate`（`goal_ac: AC-212`，ready）引入：`goalFlipDecision(records, goalId, sufficiency)` flip 当且仅当 `sufficiency?.verdict === "covered"`，`runGoalRound` 把判定落成 `value.sufficiency`（含 `goal` 与三态 `verdict`）。
- AC-213 判据当前取假：`evidence.verdict = fail`（acceptance exit 1，2026-09-09T08:36:16Z），测试文件尚不存在。
- 硬规则 3b（判定机件读不懂输入时不得返回与「合格」同形的值）本仓三次同日实测：task-status-drift-check.ts:126、slot-refill.ts:373、outer-tick-log-check.sh。充分性闸把 LLM 引入 GOAL 关闭路径——「判不出」若与「覆盖」同形，语义半不可用时全部 GOAL 静默放行关闭，比没有闸更贵（恒绿的检查是假保证）。

**本任务 = AC-213 判据面切片，只写负控制单测**：证明 sufficiency 判定为 `not-evaluated` 时（a）不触发 GOAL flip、（b）该取值在轮记录里与 `covered` 可区分。两半都由 `plugin/test/goal-sufficiency-not-evaluated.test.mjs` 断言，复用 `goal-driver.test.mjs` 的 temp-root 缝（非 fixture 注入，硬规则 4 推论三）。若测试暴露出 AC-212 实现里 `not-evaluated` 塌缩成 `covered` / 未落痕的缺陷，本任务须修 `plugin/scripts/goal-driver.ts` 并 task_write 扩 Touches（expand-touches-when-implementation-footprint-grows）。

**2026-09-09 补（本轮 scope 扩，就地为解阻塞）**：fan-in 全量 suite 红在 `gap-git-graph-task-view-aggregate-commits-by-task-id` AC6——`taskIdFromSubject` 不认尾括号 id 形态 `(gap-…)`，组计数 7 ≠ `git log --grep` 8；该红是确定性、与本任务 delta 无关、且阻塞所有 fan-in 的产品缺陷（已复现：group count (7) == git log --grep count (8)）。就地修 `serve-git.ts` 加 Form 6（尾括号已知前缀守卫）+ 补 AC1 断言与负控制，Touches 同步扩。

**范围外（各有 AC / 任务）**：充分性闸本体与 flip 条件（AC-212）；充分性判定的 LLM 提示词/成本上限（GOAL-010 风险 2 与 AC-213 共同覆盖，非本任务 criterion）；`goal-store.isGoalAchieved` 的 draft 死角（`goal-driver.ts:293-294` 另案）。

## AC

- [x] `node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-not-evaluated.test.mjs` 退出码 0（AC-213 criterion 逐字）
- [x] 负控制（expect 前半）：测试断言在域 AC 全 achieved（`goalAchievedFromRecords(records, goalId) === true`）时 `goalFlipDecision(records, goalId, {verdict:"not-evaluated"}) === false`——判不出 ≠ 通过、不触发 flip
- [x] 可区分性（expect 后半）：测试断言 `not-evaluated` 在轮记录里与 `covered` 不同形——驱动 `runGoalRound`（temp-root 缝）产出的 facts 中出现 `value.sufficiency` 且 `verdict === "not-evaluated"`（`grep -n "not-evaluated" plugin/test/goal-sufficiency-not-evaluated.test.mjs` 命中断言点）

## DoD

AC-213 criterion 两半都满足：①负控制单测证明 `sufficiency=not-evaluated` 时不触发 GOAL flip；②该取值在轮记录里与 `covered` 可区分。`plugin/test/goal-sufficiency-not-evaluated.test.mjs` 退出码 0；改动经 fan-in 落地 develop，`git show develop:plugin/test/goal-sufficiency-not-evaluated.test.mjs` 可见该文件。

## Touches

- `plugin/test/goal-sufficiency-not-evaluated.test.mjs`
- `tasks/gap-goal-sufficiency-not-evaluated.md`
- `packages/quay/src/serve-git.ts`
- `packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs`

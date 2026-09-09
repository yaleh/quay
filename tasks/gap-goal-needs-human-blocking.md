---
id: gap-goal-needs-human-blocking
title: goal AC needs-human 进词表并计入 goalAchievedFromRecords 在域集合（阻塞 GOAL 达成）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-209
---
## Proposal

正本：`goals/AC-209-ac-的-needs-human-进词表且-计入在域-阻塞-goal-达成-不阻塞的承接态与-draft-同形.md`。
人 2026-09-09 裁定 2：`needs-human` 阻塞 GOAL 达成。

**现状（实测，非主张）**：
- `VALID_GOAL_STATUSES`（`packages/quay/src/goal-store.ts:74`）= `["draft","active","achieved","superseded","retired"]`，无 `needs-human`——一条要人裁定的 AC 结构上无法写进词表（`assertSafeStatus` 会拒）。
- `goalAchievedFromRecords`（`plugin/scripts/goal-driver.ts:295-300`）的在域集合 = `{active, achieved}`，`needs-human` 不在其中。若 driver 期望退役某条 AC 时只能置 `needs-human`（裁定 1），而该状态既不进词表、又不计入在域，就与 draft 完全同形——既不挡 GOAL 达成、也不计缺口，等于白加一个状态（同 GOAL-010 立条的 draft 死信实证：AC-180/182/183/184/186/187 全程无人过问）。

**修法（两处源码 + 一处新测试 + 一处既有测试同步）**：
1. `packages/quay/src/goal-store.ts:74` 词表加 `"needs-human"`。
2. `plugin/scripts/goal-driver.ts:297` 在域过滤加 `r.status === "needs-human"`，使 `every(status === "achieved")` 在存在 needs-human AC 时为 false ⇒ 阻塞 GOAL 关闭；同步更新 `:282-294` 的「在域」doc 注释（在域 = active|achieved|needs-human）。
3. 新建 `plugin/test/goal-needs-human-blocking.test.mjs`（双向负控制，见 AC）。
4. 既有 `packages/quay/test/goal-store.test.mjs:193` 把 `VALID_GOAL_STATUSES` 钉死为 5 元素的 `deepEqual` 断言须一并更新为含 needs-human，否则全量 suite 红。

⛔ 范围外（各自另有 AC/已知缺口，本任务不碰）：`goal-store.isGoalAchieved`（其 draft 死角已在 `goal-driver.ts:293-294` 标注「另案处理」）；`computeGoalGaps` 的缺口对象集（needs-human 关联任务已由 AC-185 计入 stalled，非本 AC 对象）；driver 何时置 needs-human（AC-211）。

## AC

- [x] 新建 `plugin/test/goal-needs-human-blocking.test.mjs`，双向负控制断言：`VALID_GOAL_STATUSES.includes("needs-human")`、`goalAchievedFromRecords` 含 needs-human AC ⇒ false、全 achieved ⇒ true；`node --no-warnings --experimental-strip-types --test plugin/test/goal-needs-human-blocking.test.mjs` 退出码 0
- [x] `packages/quay/src/goal-store.ts` 的 `VALID_GOAL_STATUSES` 字面量含 `"needs-human"`（`grep -n '"needs-human"' packages/quay/src/goal-store.ts` 命中第 74 行处）
- [x] `plugin/scripts/goal-driver.ts` 的 `goalAchievedFromRecords` 在域过滤含 `r.status === "needs-human"`（`grep -n 'status === "needs-human"' plugin/scripts/goal-driver.ts` 命中且位于该函数体内）
- [x] 既有 `packages/quay/test/goal-store.test.mjs` 的 `VALID_GOAL_STATUSES` deepEqual 断言同步为含 needs-human；`node --no-warnings --experimental-strip-types --test packages/quay/test/goal-store.test.mjs` 退出码 0

## DoD

AC-209 的 criterion（`plugin/test/goal-needs-human-blocking.test.mjs`）在真实检出上运行通过（⛔ 非 fixture 注入——断言读的是 `goalAchievedFromRecords` 与 `VALID_GOAL_STATUSES` 的真实导出），且 `packages/quay/test/goal-store.test.mjs` 同步绿；两处源码改动经 fan-in 落地 develop，`git show develop:packages/quay/src/goal-store.ts` 可见 needs-human。

## Touches

- `packages/quay/src/goal-store.ts`
- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-needs-human-blocking.test.mjs`
- `packages/quay/test/goal-store.test.mjs`
- `tasks/gap-goal-needs-human-blocking.md`
---
id: gap-ac46-pool-criteria-in-gate-plus-revaluation-executor
title: AC46 未达成——pool 层静态判据移入 todo→ready 提升闸 + todo↔ready 双向重评缺执行者
status: todo
labels:
  - gap
  - mechanism
  - ac46
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-13，manager 按位置逐类核查 12 条 deferred）**：AC46 判定池层静态判据应全部移入
todo→ready 提升闸，且静态条件变质时 todo↔ready 双向重评要有周期与触发（不依赖任何人记得）。
**现状零任务在推进**（活跃集标题逐条读，命中 0；唯一沾边的 `gap-slot-refill-recommends-landed-code-complete-tasks`
[done] 做的是「不推荐」不是「清出 ready」——僵尸仍占池位，只是不再被推荐）。

**12 条 deferred 的构成（对照 AC46）**：

```
touches-overlap-in-flight   5   ✅ 安全约束，串行化正确，不必动
superseded                  2   ❌ 判据3（条件变质无人重评）→ 已第一层置终态
not-yet-flipped             2   ❌ 判据3 → 已第一层翻 done
landed-implementation       1   ❌ 判据3 → 已第一层翻 done
compound-not-dispatchable   1   ❌ 判据1【逐字点名「非 compound」】→ 已第一层 retreat 回 todo
self-touch-missing-c8       1   ❌ 判据1【逐字点名「self-touch 齐全」】→ 已第一层 retreat 回 todo+补 self-touch
```

**判据1 原文**：「原 pool 层的全部静态判据（非 fixture／非 parked／非 ac-record／**非 compound**／
**self-touch 齐全**／依赖已 done／`Touches` 指向的文件存在／产物齐全）**全部移入 todo→ready 提升闸**」。
**判据2**：「产出是"修好后晋级"或"明确的阻碍原因"，不是静默留在池里」。
**判据3**：「静态条件变质时 `todo↔ready` 双向重评有周期与触发，不依赖任何人记得——`lifecycle.ts` 的
`ready.back="todo"` 已是合法转换，**缺的是执行者**」。
**判据4**：pool=11 deficit=9 而 7 条不可派 ⇒ deficit 不可区分（第一层后 pool=4，此判据暂时恢复）。

**第一层已做（outer，2026-08-13）**：superseded×2 置终态 / not-yet-flipped×2 + landed×1 翻 done /
compound×1 retreat / self-touch×1 retreat+补 Touches ⇒ pool 9→4。**但这是手工一次性清——判据3 要的
是「周期与触发」，即下次再变质时有人自动做，不靠 outer 轮巡。**

## Plan

1. **判据1：把 compound / self-touch / deps / touches-resolve / artifacts 检查从 slot-refill 的
   step-4 defer 逻辑「提升」为 todo→ready 提升闸的准入门槛**——任务在 ready 之前就因这些条件被拒，
   而不是 ready 之后被 defer。（ready-pool-check 的 `--apply` 补晋路径已是闸的雏形，扩展它。）
2. **判据3：双向重评的执行者**——一个周期性机件（复用现有 tick/静态检查泳道），对 ready 池重跑
   判据1 的全部静态条件，条件变质（如被 superseded、被别任务实现取代、Touches 文件被删、self-touch
   缺失）⇒ 自动 `lifecycle.ts` 的 `ready.back="todo"`（转换已合法，缺的只是调用者）。**不得静默留在池里**：
   每次重评的产出是「修好后晋级」或「明确的阻碍原因 + 去向」。
3. **判据2 的产物**：重评的阻碍原因写进 tick-log / task 体，可 grep、可审计。
4. 判据4 回归：改造后 pool 里不应再有「条件变质却占池位」的任务（负控制：当前池为 4，改造后不变坏）。

## Acceptance Criteria

- [ ] AC1 compound / self-touch / deps / touches-resolve / artifacts 检查进入 todo→ready 提升闸：
      不满足者在提升时即被拒（给出阻碍原因），而非 ready 后被 defer。
- [ ] AC2 双向重评执行者存在：对 ready 池按周期重跑静态条件，条件变质 ⇒ `ready.back="todo"` 自动执行，
      产出「阻碍原因 + 去向」记录（tick-log 或 task 体），可 grep。
- [ ] AC3 负控制：当前 pool（4）改造后不引入新的条件变质任务；不再出现「静默留池」形态。
- [ ] AC4 既有 ready-pool-check / slot-refill 测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 提升闸 + 双向重评执行者落地并有测试覆盖。
- [ ] 当前池经一次重评扫描，无静默留池任务（或全部给出明确去向）。
- [ ] 判据4 的 deficit 读数在池变化时保持可区分。

## Touches

- plugin/scripts/ready-pool-check.ts（提升闸扩展：静态判据准入）
- plugin/scripts/lifecycle.ts 或调用侧（`ready.back="todo"` 的自动调用者）
- plugin/scripts/slot-refill.ts（step-4 defer 逻辑收敛到闸，避免双套判据漂移）
- plugin/test/（提升闸 + 双向重评用例）
- tasks/gap-ac46-pool-criteria-in-gate-plus-revaluation-executor.md（自身）

## Evidence

（落地后回填）

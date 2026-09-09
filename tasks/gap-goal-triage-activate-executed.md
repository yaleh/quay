---
id: gap-goal-triage-activate-executed
title: goal-driver 执行分诊 activate 判决——draft AC 经一轮 driver 后确为 active（判决零消费修复）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-223
---
## Proposal

正本：`goals/AC-223-分诊判出-activate-后-driver-必须执行它-判决零消费等于-分诊-只做了一半-goal-010-退出条件①.md`（GOAL-010 名下 criterion）。判据两半：机制半 `node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-activate-executed.test.mjs`；生产半 `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts list | python3 -c '…to=="active" ∧ actor 以 goal-driver 开头…'`。范围 = GOAL-010 退出条件①「且 `activate` 判决被 driver 实际执行」。

**现状（实测，非主张）**：
- `writeGoalStatus` 全仓仅两调用点（`plugin/scripts/goal-driver.ts:789`、`:812`），两处都写 `"achieved"`——没有任何路径写 `"active"`。
- 分诊判决零消费：`triageDraftAc`（`:520`）产出四态判决，`:842` `triage.push(...)` 落进 `triage` 数组进轮记录，但 `decision` 字段再无任何消费者。
- 全账本 `flips` 目标态分布无 `to=="active"`；`goals/` 全部记录 `statusLog` 里 `to=="active" ∧ actor 以 goal-driver 开头` = 0——一次机器激活都没发生过（立条时生产半判据红）。
- 分诊只做了「产出判决」那一半，「消费」从未接线——与 AC-210 判据（只要求留痕）、GOAL-010 退出条件①原文同族：两处都只写了一半。

**修法（一处源码 + 一处新测试）**：
1. `plugin/scripts/goal-driver.ts`：在 `runGoalRound` 的分诊循环（`:840-850`）之后，消费 `activate` 判决——对每条 `decision === "activate"` 的 triage 条目调 `writeGoalStatus(scriptRoot, ac, "active", dataRoot, { actor: "goal-driver", reason: "triage: activate" })`，结果记入 `flips`（`to: "active"`）。⛔ 只消费 `activate` 一态：`re-anchor`/`needs-human`/`hold` 仍只落痕不 flip；⛔ 不写 `retired`（裁定 1，AC-211 单测守着）。激活走 `writeGoalStatus → goal-store write`，会被 `goal-store.ts:762/771` 的 not-evaluated 前置闸与 `:827` 的 cap 闸挡住（AC-223 origin 风险 C 的守护，driver 无需复制该判断）。
2. 新建 `plugin/test/goal-triage-activate-executed.test.mjs`：正向 + 三条负控制（见 AC）。

⛔ 边界（各自已有 AC，均 done，本任务不碰）：分诊函数本体（AC-210）；posture 尊重（AC-215）；充分性闸（AC-212）；needs-human 阻塞（AC-209）；retire→needs-human 写面（AC-211）。本任务只接「execute activate」这一条缝。

## AC

- [x] `node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-activate-executed.test.mjs` 退出码 0（AC-223 机制半逐字）
- [x] 正向：测试断言分诊判 `activate` 的 draft AC 经一轮 driver 后 `flips` 含 `to=="active"`（`writeGoalStatus` 以 `"active"` 被调、目标 status 翻 active）
- [x] 负控制 (a)：测试断言判 `hold`/`re-anchor`/`needs-human` 的 AC 不被激活（`flips` 无该 ac 的 `to=="active"` 条目）
- [x] 负控制 (b)：测试断言 posture 已声明（measure-only，AC-215）的 GOAL 名下 draft AC 不被激活
- [x] 负控制 (c)：测试断言 driver 不写 `retired`（`flips` 无 `to=="retired"`；`plugin/test/goal-triage-no-driver-retire.test.mjs` 仍绿）
- [ ] 生产半判据（生产）：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts list | python3 -c 'import json,sys; d=json.load(sys.stdin); n=sum(1 for r in d for e in (r.get("statusLog") or []) if str(e.get("to"))=="active" and str(e.get("actor","")).startswith("goal-driver")); print("driver-activations:",n); sys.exit(0 if n>=1 else 1)'` 退出码 0（落地后一轮 driver 跑过，非 fixture）（待外部）
- [x] scoped 门 `bash scripts/test.sh --for-task gap-goal-triage-activate-executed --allow-thin` 退出码 0

## DoD

AC-223 两半都满足：①机制半 `plugin/test/goal-triage-activate-executed.test.mjs` 退出码 0，三条负控制各带一条「改坏 ⇒ 测试红」的取假路径（硬规则 4 推论三）；②生产半——落地后 driver 真的执行过一次激活：`goals/` 载体里存在 ≥1 条 AC 记录其 `statusLog` 含 `to=="active"` 且 `actor` 以 `goal-driver` 开头（⛔ 非 fixture——反例判据：把执行 seam 关掉后 DoD 仍通过 ⇒ 不是测量）。改动经 fan-in 落地 develop，`git show develop:plugin/test/goal-triage-activate-executed.test.mjs` 可见该文件。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-triage-activate-executed.test.mjs`
- `tasks/gap-goal-triage-activate-executed.md`
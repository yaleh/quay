---
id: gap-meta-goal-store-activation-gate
title: GOAL 激活写面缺「名下至少一条 AC」前置——P6/P6b 逐字 `!isGoalRecord`，零 AC 的 GOAL 可被激活且无检测
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
GOAL-014 于 2026-09-12T00:33:10Z（本轮前约 27 分钟）被激活但名下零 AC（readings.criteria 为空、goals.GOAL-014.status=active），违反已声明的 AC-217「活跃 GOAL 至少一条 AC」；而唯一检测该不变式的 AC-217 已随 GOAL-010 achieved 离开 I5 复验域（未声明 long-term），故这次违反没有任何机件报红。写面 packages/quay/src/goal-store.ts:987 / :1014 的两道激活闸逐字 `!isGoalRecord`——只对 criterion 记录生效（可评估性 + 保真性），GOAL 激活仅查 body 长度与 active cap。修法：把该前置加进同一道激活闸（fail-closed，拒绝时枚举名下 AC 数，⛔ 不 fail-open、⛔ 不加「新机制」）。

本轮读数（goals.GOAL-014.status）= `"active"`，采于 2026-09-12T01:00:51Z，由 meta-driver 机械采集。
涉及机制关键词：`goal-store-activation-gate`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/goal-activation-requires-ac.test.mjs` ⇒ 该测试断言写面行为（不读源码版式）：名下零 AC 的 GOAL 激活被 fail-closed 拒绝（非 0 退出、讯息枚举名下 AC 数 = 0），名下有 ≥1 AC 的 GOAL 正常放行，且零 AC 的 draft GOAL 仍可创建——今天红（行为缺失 / 文件不存在），实现后绿。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `packages/quay/src/goal-store.ts`
- `plugin/test/goal-activation-requires-ac.test.mjs`
- `tasks/gap-meta-goal-store-activation-gate.md`
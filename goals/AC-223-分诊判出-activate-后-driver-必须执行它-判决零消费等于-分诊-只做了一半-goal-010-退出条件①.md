---
id: AC-223
title: 分诊判出 activate 后 driver 必须执行它——判决零消费等于「分诊」只做了一半（GOAL-010 退出条件①）
status: achieved
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/goal-triage-activate-executed.test.mjs && node --no-warnings
  --experimental-strip-types packages/quay/src/goal-store.ts list | python3 -c
  'import json,sys; d=json.load(sys.stdin); n=sum(1 for r in d for e in
  (r.get("statusLog") or []) if str(e.get("to"))=="active" and
  str(e.get("actor","")).startswith("goal-driver"));
  print("driver-activations:",n,file=sys.stderr); sys.exit(0 if n>=1 else 1)'
expect: >-
  两半都绿才算达成，缺一不可：


  ① 机制半（`plugin/test/goal-triage-activate-executed.test.mjs`）——分诊判出 `activate` 的
  draft AC，在一轮 driver 之后 status 确为 `active`；且三条负控制同时成立：(a) 判 `hold` /
  `re-anchor` / `needs-human` 的 AC 不被激活；(b) posture 已声明（AC-215）的 GOAL 名下的 draft
  AC 不被激活；(c) driver 仍不写 `retired`（裁定 1 不被这次新增的执行路径破坏）。


  ② 生产半（读真实 `goals/` 载体，非 fixture）——存在 ≥1 条 AC 记录，其 `statusLog` 含一条 `to ==
  "active"` 且 `actor` 以 `goal-driver` 开头的条目，即机器真的执行过一次激活。立条时实测读数 = 0（红）。


  选 `statusLog` 而非 `.quay/goal-round.jsonl` 的 `flips` 作生产半载体，是因为 `actor`
  字段能把「driver 激活」与「人激活」区分开（人激活记 `goal-cli`），且它落在记录自身、不依赖 driver 如何组织轮读数（硬规则
  4c：判据的量必须穿过所有中间层仍取得到）。`statusLog` 单调追加 ⇒ 达成后不回退，符合本 GOAL 风险 5 的判据纪律。
origin: >-
  2026-09-09 实测（非主张）：goal-driver 根本不执行分诊的 `activate`
  判决——「分诊」这一范围只做了产出判决那一半，消费那一半从未接线。


  【三个逐字读数】

  1. `writeGoalStatus` 全仓只有两个调用点（`goal-driver.ts:789` 与 `:812`），**两处写的都是
  `"achieved"`**；没有任何路径写 `"active"`。

  2. `grep 'entry.decision ===' plugin/scripts/goal-driver.ts`
  返回空——分诊判决**零消费**。（AC-219 的修复移除了 retire→needs-human 那一支之后，判决集合再无任何消费者。）

  3. 全账本 `flips` 的目标态分布 = `{achieved: 87, needs-human: 3}`，`to == "active"` 计数
  **0**；`goals/` 全部 91 条记录的 `statusLog` 里 `to=="active" ∧ actor 以 goal-driver
  开头` 的条目也是 **0**——**一次机器激活都没发生过**。


  【与裁定 1 的落差】人 2026-09-09 裁定 1 逐字：「晋升应当是语义的。放弃（retire）不交给 goal-driver」。⇒ 裁定把
  `retire` 划归人，同时把**晋升**划给机器；现状是两件都归人，机器只会写 `achieved`。


  【为何是第三次同族】AC-210 的判据只要求「每条 draft AC 都被分诊出判决并留痕」，**未要求判决被执行**——与 GOAL-010 退出条件
  1 的原文（「每条都会被分诊出一个判决并留痕。」）一致，两处都只写了一半。这与本 GOAL 已抓到的另外两次「判据只写一个方向」同族（AC-217
  的判据曾漏掉 status 限定；AC-212 的充分性闸只能产出 `insufficient`/`not-evaluated`、永远产不出
  `covered`，由 AC-222 补另一半）。⇒ 本 AC 立条同时修订 GOAL-010 退出条件 1 的文本，补上「且 `activate` 判决被
  driver 实际执行」，否则同一个错误会在验收时第四次通过。


  【为何现在才安全落地】让 driver 执行激活有三个风险，逐条已被今天先落地的机制覆盖，**换在今天上午立这条是危险的**：

  - 风险 A「激活后立刻 flip 致 GOAL 关闭」⇒ AC-212 充分性闸（achieved），已实测挡下 GOAL-011 的第四次假达成。

  - 风险 B「激活人刻意留 draft 的 AC」⇒ AC-215 posture（achieved）。

  - 风险 C「激活判据不可评估的 AC」⇒ `packages/quay/src/goal-store.ts:762/771` 的激活前置闸，逐字
  `cannot activate ${id}: criterion not-evaluated (…) — pass --force to
  override`；driver 走 `writeGoalStatus → goal-store write`，**会被同一道闸挡住**。


  【范围限定，⛔ 不得越界】本 AC 只让 `activate` 一态变成可执行；`retire` / `retired` 仍归人（裁定 1 + SPEC
  §6.1「放弃是判断不是计算」），且这一点由机制半的负控制 (c) 守住。


  【顺带记账，不另立条】分诊判决的历史分布 = `{retire: 25, hold: 43}`，其中 `retire` 自 AC-219 的修复后不再产生
  ⇒ AC-211（driver 期望退役时置 `needs-human` 并说明理由）现在结构上不可能被触发。它没有变成假条（「driver 不许写
  retired」这条约束仍正确且被单测守着），但其保护对象已从「一个会发生的行为」变成「一个不再发生的行为」。
activatedAt: 2026-09-09T15:26:58.624Z
statusLog:
  - at: 2026-09-09T15:26:58.624Z
    from: draft
    to: active
    actor: cli:human-ruling-2026-09-09
    reason: 人授权直接 active：接受 GOAL-010 推迟关闭
  - at: 2026-09-09T16:48:29.823Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

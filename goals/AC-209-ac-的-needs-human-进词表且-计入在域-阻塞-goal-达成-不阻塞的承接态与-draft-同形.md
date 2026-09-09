---
id: AC-209
title: AC 的 needs-human 进词表且【计入在域、阻塞 GOAL 达成】——不阻塞的承接态与 draft 同形
status: draft
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/goal-needs-human-blocking.test.mjs
expect: goal 记录词表含 needs-human，且 goalAchievedFromRecords 的在域集合含它——一条 needs-human
  的 AC 会使该 GOAL 的达成判定为 false（阻塞关闭）；双向负控制单测同时覆盖「含 needs-human ⇒ false」与「全
  achieved ⇒ true」两个方向。
origin: 人 2026-09-09 裁定 2：「needs-human 阻塞 GOAL
  达成」。现状实测：VALID_GOAL_STATUSES（goal-store.ts:74）=
  draft|active|achieved|superseded|retired，无
  needs-human；goalAchievedFromRecords（goal-driver.ts:285）的在域集合 = {active,
  achieved}。代价实证：GOAL-001 名下 6 条 draft AC（AC-180/182/183/184/186/187）从
  2026-09-06 创建到 2026-09-09 退役全程无人过问，正因为 draft 不挡达成——一个不阻塞的承接态与 draft
  完全同形，等于白加一个状态。
---

---
id: AC-211
title: driver 不越权放弃——期望退役的 AC 只能置 needs-human 并说明理由，retired 归人
status: draft
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/goal-triage-no-driver-retire.test.mjs
expect: 判据 exit 0
origin: 人 2026-09-09 裁定 1：「放弃（retire）不交给 goal-driver；如有它期望 retire 的 AC，应置为
  needs-human 并说明理由，交人判断」，与 SPEC-goal-mechanism-2026-09-06 §6.1「放弃是判断不是计算，driver
  只报红不翻状态」对称。实测支撑：2026-09-09 04:24–04:48 退役 AC-180/184/186
  的理由是「类别错误：活性判据写成目标判据」——这是个语义判断，且方向不可逆（goal-driver.ts:183-187
  自陈全仓无反向翻转，一旦翻错即永久锁定）。故最不可逆的一态必须挡在人这一侧，driver 只能建议且必须说明理由。
---

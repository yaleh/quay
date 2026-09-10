---
id: AC-181
title: meta-driver 必须在生产载体上留下新鲜轮次——「实现了但生产没跑过」与「没实现」同形
status: retired
kind: criterion
goal: GOAL-001
criterion: test -f .quay/meta-driver-round.jsonl && [ $(( $(date +%s) - $(stat
  -c %Y .quay/meta-driver-round.jsonl) )) -lt 5400 ]
expect: 主检出的 .quay/meta-driver-round.jsonl 存在，且末次写入距今 < 90 分钟（复核间隔 20 分钟的宽裕余量）⇒
  meta-driver 确实在生产持续产出轮次，而不只是「注册好了」
origin: >-
  【退役 2026-09-06，立条人自行更正——这是一个类别错误，不是判据写坏】


  原判据：`test -f .quay/meta-driver-round.jsonl && [ $(( $(date +%s) - $(stat -c %Y
  ...) )) -lt 5400 ]`（载体末次写入距今 < 90 分钟）。


  【错在哪】这是一个**活性监控项**，被我写成了**目标判据**。二者语义不同：目标判据描述「达成之后不再回退的状态」，而活性天然会回退（driver
  一停就假）。


  【为什么不能放着不管】`writeGoalStatus` 全仓恰好 2 个调用点（goal-driver.ts:268 / :276），**都写
  "achieved"，没有反向翻转**。一旦本条被翻成 achieved 即永久锁定——meta-driver
  日后停摆，这条记录仍会永久声称一件已不成立的事。目标存量里出现一条「结构上不可能变假」的达成记录，正是硬规则 4 要防的东西。


  【需求本身有归宿，不是被丢弃】「meta-driver
  是否真在生产产出轮次」这个关切是成立的（立条当时它确实从未在生产跑过），但它已被既有读数覆盖：`carrierStats(root, "meta")` 实测
  `records=731, lastTs=2026-09-06T23:39:06.408Z`，经由 `drivers.meta.staleSecs` 每轮进
  meta-driver 读数。⇒ 本条与之冗余，退役不留缺口。


  【留给后来者的判准】立 AC 之前先问：这个量会不会回退？会回退的属监控面（drivers 读数 /
  告警），不属目标判据面。目标判据面只放「达成即终态」的量。


  【与其它两条的关系】AC-180 / AC-182 的处置（提上来让 GOAL-001 收口，还是 --goal 改挂）是方向裁定，⛔ 保留给人，本次不动。

  【已知未解】退役【不】解除对 GOAL-001 的阻塞：goal-driver.ts:172 的 `acs.every(r => r.status ===
  "achieved")` 不排除 retired/superseded ⇒ 本条仍会挡着。该口径问题属
  gap-goal-driver-draft-ac-invisible-yet-blocking 的范围，不在本次自我更正内。
---

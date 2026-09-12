---
id: AC-212
title: 充分性闸挡住「AC 全绿即关闭」——退出条件未被覆盖时 GOAL 不得自行关闭
status: achieved
kind: criterion
goal: GOAL-010
criterion: >-
  python3 -c '

  import json,sys

  ok=[s for l in open(".quay/goal-round.jsonl") for f in
  (json.loads(l).get("facts") or []) for s in [(f.get("value") or
  {}).get("sufficiency")] if isinstance(s,dict) and s.get("goal") and
  s.get("verdict") in ("covered","insufficient","not-evaluated")]

  if len(ok)<1:
      sys.stderr.write("CAUSE=goal-round-jsonl-has-no-sufficiency-fact-with-a-known-verdict\n"); sys.exit(1)
  ' && node --no-warnings --experimental-strip-types --test
  plugin/test/goal-sufficiency-gate.test.mjs
expect: 生产轮记录中存在 ≥1 条 sufficiency 判定（带 goal 与 covered/insufficient/not-evaluated
  三态之一），且负控制单测证明「在域 AC 全绿但充分性判 insufficient ⇒ 不 flip GOAL」——GOAL 的达成判定不再是纯语法合取。
origin: >-
  goalAchievedFromRecords（goal-driver.ts:283-288）是纯语法合取——「所有在域 AC 都 achieved ⇒
  GOAL achieved」，没有任何环节判过「这组 AC 若全绿，是否等于 body 的退出条件达成」。实测两例：①GOAL-001 于
  2026-09-07T12:29:05Z 在 6 条 draft 旁边被 flip achieved；②GOAL-005/007/008 在 body
  为空（退出条件从未写下）的情况下被判达成。立条时 .quay/goal-round.jsonl 中 sufficiency 记录 = 0 条，故判据取假。


  【实证补强 2026-09-09——本 GOAL 自己被本条要修的缺陷关闭】


  GOAL-010 于 2026-09-09T07:55:09Z 被 I2 机械 flip 为 achieved。同一条轮记录里它名下 8 条 AC
  的现场是：achieved 1（AC-208）+ active 1（AC-209，当轮 pass 后被翻）+ **draft 6，且这 6 条的
  verdict 全部为
  fail**（AC-210/211/212/213/215/216）。即：机制在同一轮里一边逐条记下「这六个条件都是假的」，一边宣布目标达成。按
  GOAL-010 body 的 5 条退出条件衡量，当时一条都未达成。


  这比本条 origin 上半部引的 GOAL-001 更硬：GOAL-001 flip 当轮那 6 条 draft 恰好都是
  pass，而这次**红的判据也一样挡不住关闭**——说明缺口与判据真假无关，纯粹是作用域问题。


  根因不是操作失误而是结构：`achieved ⟺ 所有【在域】AC 都 achieved`，而 draft 不在域 ⇒
  **任何分批激活，在该批全部完成的那一刻就会关闭目标**，与还剩多少条未激活无关。⇒ 在本
  AC（充分性闸）落地之前，「先激活两条看看」这种稳妥做法在结构上不安全，安全形态只有「一次性激活全部 AC」或「等本 AC 落地」。


  处置：人 2026-09-09 授权按对照实验的 B 形态重启——先把 6 条 draft 全部激活（此时 GOAL-010 仍为
  achieved，driver 不评估已关闭 GOAL 名下的 AC，故无竞态窗口），再把 GOAL-010 翻回 active，使 flip
  生效那一刻在域集合已含 6 条红 AC（`goalAchievedFromRecords` = false）。⛔ 反序会在 ~50
  秒内被再次自我关闭——对照实验 A 形态（只翻 GOAL、6 条 draft 不动）实测返回 TRUE。
statusLog:
  - at: 2026-09-09T10:40:15.591Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

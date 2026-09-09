---
id: AC-215
title: 分诊尊重 GOAL 层 posture——人已声明「只测量不激活」的 GOAL，driver 不得越权 activate
status: achieved
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/goal-posture-blocks-activate.test.mjs
expect: goal 记录支持显式 posture 声明（如 measure-only），且分诊对声明了该 posture 的 GOAL 名下的 draft
  AC 不得判 activate——只能落在 re-anchor / needs-human / hold 三态。双向负控制单测覆盖两个方向：未声明
  posture 的 GOAL ⇒ activate 可达；已声明 ⇒ activate 被拒且判决落在其余三态之一。
origin: >-
  人 2026-09-09 裁定加立本条（触发：驱动 GOAL-009 的 peer 会话报出的姿态冲突，本会话已独立复核其全部事实断言）。


  实测冲突：AC-210 的分诊对象集是「active GOAL 名下的 draft AC」，而 GOAL-009 status=active、其
  AC-201..207 + AC-214 共 8 条全部 status=draft ⇒ 正好在射程内。人 2026-09-09 对 GOAL-009
  是【刻意】只激活 goal 层、把 AC 留 draft 的（先测量后承诺），生产载体已验证该姿态成立（criterionCount=7 全部真跑且
  verdict=fail、flips=[]、gaps=0、spawned=0）。AC-210 一落地，这 8 条可能被判 activate
  并翻转；每条激活后无在飞任务即成缺口（goal-driver.ts:345）⇒ 自动派 8 个任务 ⇒ 人的裁定在无人察觉的一轮里被静默推翻。


  根因：`draft` 重载——它同时表示「还没人看过」（GOAL-001 那 6 条死信，正是 GOAL-010
  要修的）与「人看过了、刻意先不激活」（GOAL-009）。故⛔ 不能靠「分诊默认判 hold」解决，那会废掉 GOAL-010 的主要价值。


  选 GOAL 层 posture 而非 per-AC hold 标记的决定性理由：AC-214 是在人做出姿态决定【之后】才新建的 ⇒ per-AC
  标记必然漏掉后来新增的 AC，GOAL 层声明自动覆盖。


  与 AC-211 同形（都是「driver 不得覆盖人已做出的决定」，前者管 retire、本条管 activate），按人裁定「六条分开」故单列。
statusLog:
  - at: 2026-09-09T10:03:36.164Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

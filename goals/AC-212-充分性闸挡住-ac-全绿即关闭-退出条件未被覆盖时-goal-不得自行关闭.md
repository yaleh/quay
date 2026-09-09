---
id: AC-212
title: 充分性闸挡住「AC 全绿即关闭」——退出条件未被覆盖时 GOAL 不得自行关闭
status: draft
kind: criterion
goal: GOAL-010
criterion: python3 -c 'import json,sys; ok=[s for l in
  open(".quay/goal-round.jsonl") for f in (json.loads(l).get("facts") or []) for
  s in [(f.get("value") or {}).get("sufficiency")] if isinstance(s,dict) and
  s.get("goal") and s.get("verdict") in
  ("covered","insufficient","not-evaluated")]; sys.exit(0 if len(ok)>=1 else 1)'
  && node --no-warnings --experimental-strip-types --test
  plugin/test/goal-sufficiency-gate.test.mjs
expect: 判据 exit 0
origin: goalAchievedFromRecords（goal-driver.ts:283-288）是纯语法合取——「所有在域 AC 都
  achieved ⇒ GOAL achieved」，没有任何环节判过「这组 AC 若全绿，是否等于 body 的退出条件达成」。实测两例：①GOAL-001
  于 2026-09-07T12:29:05Z 在 6 条 draft 旁边被 flip achieved；②GOAL-005/007/008 在 body
  为空（退出条件从未写下）的情况下被判达成。立条时 .quay/goal-round.jsonl 中 sufficiency 记录 = 0 条，故判据取假。
---

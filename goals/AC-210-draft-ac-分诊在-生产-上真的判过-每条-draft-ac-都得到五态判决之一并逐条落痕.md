---
id: AC-210
title: draft AC 分诊在【生产】上真的判过——每条 draft AC 都得到五态判决之一并逐条落痕
status: achieved
kind: criterion
goal: GOAL-010
criterion: >-
  python3 -c '

  import json,sys

  ok=[t for l in open(".quay/goal-round.jsonl") for f in
  (json.loads(l).get("facts") or []) for t in ((f.get("value") or
  {}).get("triage") or []) if t.get("ac") and t.get("decision") in
  ("activate","re-anchor","retire","needs-human","hold")]

  if len(ok)<1:
      sys.stderr.write("CAUSE=goal-round-jsonl-has-no-triage-fact-with-a-known-decision\n"); sys.exit(1)
  '
expect: .quay/goal-round.jsonl 中存在 ≥1 条 triage 记录，逐条带 ac 与五态判决之一（activate /
  re-anchor / retire / needs-human / hold）——分诊在【生产】上真的对 draft AC
  做过判决并留了痕，而不只是在单测里「能产出」（硬规则 4 推论三）。
origin: G9 缺口环当前只对 status=active 且零关联任务的 AC 开火（goal-driver.ts:345 `if
  (String(r.status ?? "") !== "active") continue`）⇒ draft AC 结构上永不进入 spawn
  对象集，无任何机制会过问它。实测代价：过去 72h 内父 GOAL 已 active 时动态新增 AC 共 10 条，5 条被人恰好激活并计入判定，另 5
  条卡在 draft 直到父 GOAL 关闭。硬规则 4 推论三（只被 fixture/单测满足的判据不是测量，只证明「能产出」不证明「已产出」）⇒ 本 AC
  读生产载体 .quay/goal-round.jsonl；立条时该载体 triage 记录 = 0 条，故判据取假。
statusLog:
  - at: 2026-09-09T09:25:53.058Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

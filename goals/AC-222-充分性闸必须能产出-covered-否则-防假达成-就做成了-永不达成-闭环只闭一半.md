---
id: AC-222
title: 充分性闸必须能产出 covered——否则「防假达成」就做成了「永不达成」，闭环只闭一半
status: achieved
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/goal-sufficiency-semantic-covered.test.mjs && python3 -c 'import
  json,sys; ok=[s for l in open(".quay/goal-round.jsonl") for f in
  (json.loads(l).get("facts") or []) for s in [(f.get("value") or
  {}).get("sufficiency")] if isinstance(s,dict) and
  s.get("verdict")=="covered"]; sys.exit(0 if len(ok)>=1 else 1)'
expect: 充分性闸能产出 `covered`，且不是靠放水：①负控制单测证明语义判定路径存在且三态可分——判「覆盖」⇒ covered（flip
  可发生）、判「不覆盖」⇒ insufficient、**LLM 不可用/超时/读不懂 ⇒ not-evaluated（⛔ 不得回落
  covered）**；②生产轮记录里出现过 ≥1 条 `sufficiency.verdict == "covered"`。⇒ GOAL
  重新具备【自动】关闭能力，而不是把「防假达成」做成「永不达成」。
origin: >-
  人 2026-09-09 裁定加立本条（原话：「补一条 AC 要求语义半…这样 GOAL 才能重新具备自动关闭能力，且 GOAL-010
  自己会是第一个用例」）。⚠️ 人当时说的号是 AC-220，但该号已被 GOAL-011 的退出条件②占用（2026-09-09T13:59:21 由
  peer 会话创建），故按硬规则 8（编号不得复用）改用 AC-222。


  实测缺口：`goalSufficiencyVerdict`（goal-driver.ts:354-356）只有两条 return ——
  `insufficient`（无退出条件 / 零在域 AC）与 `not-evaluated`，**结构上永不产 covered**；而 flip
  条件（:333）要求 `sufficiency?.verdict === "covered"` ⇒ **没有任何 GOAL 能被机械关闭**。生产读数：三个
  active GOAL 连续多轮全 `not-evaluated`，全账本 `covered` 记录数 = 0（零计数负控制：同一谓词换成
  `not-evaluated` 命中 251 条 ⇒ 这个零是真零，不是谓词写坏）。GOAL-010 现处「10/10
  achieved、goalAchievedFromRecords=true、I4 报 divergent、却无法关闭」的状态，是本缺口的直接后果。


  责任真空的成因（三方互指，逐字）：`gap-goal-sufficiency-gate`（AC-212 实现，done）:27 把 LLM
  推给「AC-213 与 GOAL-010 风险 2」；`gap-goal-sufficiency-not-evaluated`（AC-213
  实现，done）:28 又推给「风险 2 与 AC-213」——而它自己就是 AC-213；`goal-driver.ts:800`
  注释写「覆盖与否的语义判定归 AC-213 的 LLM」。而 AC-213 的 expect 只要求「not-evaluated 不触发 flip 且与
  covered 可分」，从不要求语义半。三方各自都满足了自己的判据。


  根因：GOAL-010 退出条件 2 只写了单向——「GOAL 不会在退出条件未被覆盖时自行关闭」，未要求「覆盖时能关闭」。一个永不判 covered
  的实现完美满足它。⇒ **一个只禁止「做错」而不要求「做对」的判据，会被「什么都不做」完美满足**（硬规则 3b
  的第三面：「永不通过」与「正确地拒绝」在记录上同形）。


  ⚠️ 本条判据的负控制不可省：若只要求「生产里出现过 covered」，可被「无条件 return
  covered」满足——那会原样重演最初的「纯语法合取即关闭」缺陷（AC-212 origin 记录的三次假 achieved）。故判据必须同时要求「LLM
  不可用 ⇒ not-evaluated，⛔ 不得回落 covered」。
activatedAt: 2026-09-09T16:35:25.310Z
statusLog:
  - at: 2026-09-09T16:35:25.310Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-09-09T17:41:02.237Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

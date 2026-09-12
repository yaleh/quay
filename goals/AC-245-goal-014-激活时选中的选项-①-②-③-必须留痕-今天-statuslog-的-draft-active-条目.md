---
id: AC-245
title: GOAL-014 激活时选中的选项（①/②/③）必须留痕——今天 statusLog 的 draft→active 条目 reason
  为空，其退出条件②③不可判定
status: active
kind: criterion
goal: GOAL-014
criterion: node --no-warnings --experimental-strip-types
  packages/quay/src/goal-store.ts get GOAL-014 | python3 -c 'import json,sys;
  r=json.load(sys.stdin); log=[e for e in (r.get("statusLog") or []) if
  str(e.get("to"))=="active"]; sys.exit(0 if log and str(log[-1].get("reason")
  or "").strip() else 1)'
expect: GOAL-014 的 statusLog 中 to=active 那条带非空 reason（写明选中①/②/③ 与一句理由）⇒
  退出条件②③可判定；今天该条 reason 为空 ⇒ 判据红（本轮已实跑确认 exit 1，且 statusLog 键存在，不是「缺值」）。
origin: readings.goals 列 GOAL-014 为 active 而 readings.criteria 为空（名下零 AC，已由本轮实跑
  goal-store 判据确认 bare=[GOAL-014]）；本轮实跑 `goal-store get GOAL-014` 得
  statusLog=[{from:draft,to:active,actor:goal-cli,reason:""}]，而同一记录的退出条件①逐字要求「作出选择并留痕」。
activatedAt: 2026-09-12T01:05:11.631Z
statusLog:
  - at: 2026-09-12T01:05:11.631Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-12T01:05:11.630Z
---

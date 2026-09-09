---
id: AC-217
title: 每个活跃 GOAL 至少有一条 AC——活跃目标无退出条件不可判定达成
status: needs-human
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types
  packages/quay/src/goal-store.ts list | python3 -c 'import json,sys;
  d=json.load(sys.stdin); goals=[str(r["id"]) for r in d if
  str(r.get("id","")).startswith("GOAL-") and str(r.get("status")) not in
  ("superseded","retired")]; covered={str(r.get("goal")) for r in d if
  r.get("goal")}; bare=[g for g in goals if g not in covered]; sys.exit(1 if
  bare else 0)'
expect: readings 中每个活跃 GOAL 在 goal-store 里都至少挂一条 AC 记录；当前 GOAL-011 无任何
  AC，本判据失败直至其退出条件被补齐
origin: readings.goals 列 GOAL-011（store-commit 传播策略）为 active，而 readings.criteria
  中无任何 goal=GOAL-011 的条目——活跃目标无退出条件；AC-208 的判据只查 body≥40 字符，识别不了「有 body 却无
  AC」的目标
statusLog:
  - at: 2026-09-09T09:37:09.309Z
    from: draft
    to: needs-human
    actor: goal-driver
    reason: triage 判 retire：建议退役但 retired 归人——driver 置 needs-human 交人判断
---

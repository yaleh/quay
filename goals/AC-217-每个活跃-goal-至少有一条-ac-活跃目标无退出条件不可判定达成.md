---
id: AC-217
title: 每个活跃 GOAL 至少有一条 AC——活跃目标无退出条件不可判定达成
status: achieved
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types
  packages/quay/src/goal-store.ts list | python3 -c 'import json,sys;
  d=json.load(sys.stdin); goals=[str(r["id"]) for r in d if
  str(r.get("id","")).startswith("GOAL-") and str(r.get("status")) in
  ("draft","active")]; covered={str(r.get("goal")) for r in d if r.get("goal")};
  bare=[g for g in goals if g not in covered]; sys.exit(1 if bare else 0)'
expect: status ∈ {draft, active} 的 GOAL 中，没有任何一条 AC 的条数 ==
  0——每个仍在流通的目标都有可判定的退出条件。⛔ 不追究已 achieved/superseded/retired 的历史目标（人 2026-09-09
  裁定②）。判据仍能取假：任何无 AC 的 GOAL 一旦进入 draft/active 即报红。
origin: >-
  readings.goals 列 GOAL-011（store-commit 传播策略）为 active，而 readings.criteria 中无任何
  goal=GOAL-011 的条目——活跃目标无退出条件；AC-208 的判据只查 body≥40 字符，识别不了「有 body 却无 AC」的目标


  【判据收窄 2026-09-09，人裁定②】原判据作用域是「非 superseded/retired 的 GOAL」，把已 achieved
  的历史目标也算了进来——实测唯一命中的是 GOAL-005（achieved、AC 数
  0，一条当年未立判据就被判达成的历史目标）。人裁定：「要求一条已关闭的历史目标补 AC
  意义不大，『仍在流通的活跃目标必须有退出条件』才是这条不变式的真意」。故作用域收窄为 status ∈ {draft, active}。


  负控制（收窄后仍能取假，⛔ 非空过）：当前 draft/active 的 GOAL-009/010/011 均有 AC ⇒ pass；注入一个无 AC 的
  active GOAL-999 ⇒ fail；把 GOAL-005 改回 active ⇒ fail。


  同时本条由 needs-human 拨回 active：它是被 goal-driver 分诊于 2026-09-09 判 retire 而置
  needs-human 的，而该分诊缺陷已由
  gap-meta-goal-triage-fresh-draft-not-retire（done）修复（默认分支 retire→hold、移除 retire
  词态）。
activatedAt: 2026-09-09T13:31:39.117Z
statusLog:
  - at: 2026-09-09T09:37:09.309Z
    from: draft
    to: needs-human
    actor: goal-driver
    reason: triage 判 retire：建议退役但 retired 归人——driver 置 needs-human 交人判断
  - at: 2026-09-09T13:31:39.117Z
    from: needs-human
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-09T13:33:26.410Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

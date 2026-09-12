---
id: AC-216
title: 长期保证 AC 的复验域不随 GOAL 关闭而消失——⛔ 达成即停止复验会让「上移一层」变成换层藏同一缺陷
status: achieved
kind: criterion
goal: GOAL-010
criterion: |-
  node --no-warnings --experimental-strip-types --test plugin/test/goal-standing-ac-reverify-scope.test.mjs && python3 -c '
  import json,subprocess,sys
  r=json.loads(subprocess.run(["node","--no-warnings","--experimental-strip-types","packages/quay/src/goal-store.ts","list"],capture_output=True,text=True).stdout)
  gs={str(x["id"]):str(x.get("status")) for x in r if str(x["id"]).startswith("GOAL-")}
  go={str(x["id"]):str(x.get("goal") or "") for x in r}
  hits=[a for l in open(".quay/goal-round.jsonl") for f in (json.loads(l).get("facts") or []) for a in (((f.get("value") or {}).get("achievedFailing") or {}).get("inScope") or []) if gs.get(go.get(str(a),""))=="achieved"]
  if not hits:
      sys.stderr.write("CAUSE=goal-round-jsonl-has-no-achieved-failing-ac-under-an-achieved-goal\n"); sys.exit(1)
  '
expect: 声明为「长期保证」的 achieved AC，其复验（I5 checkAchievedFailing）作用域不随其 GOAL
  关闭而消失；未声明的仍按现状随 GOAL 关闭离开作用域（控成本）。双向负控制单测覆盖两方向；且 achievedFailing
  读数枚举在域集合（inScope 数组，硬规则 3：枚举不布尔），生产轮记录中存在 ≥1 条其 inScope 含某条【其 GOAL 已
  achieved】的 AC——证明复验在生产上真的跨过了 GOAL 关闭，而非只在单测里成立（硬规则 4 推论三）。
origin: >-
  人 2026-09-09 裁定加立本条（触发：驱动 GOAL-009 的 peer 会话，本会话独立复核并补强）。


  机制事实：I5 作用域逐字为「Scope: achieved ACs under ACTIVE goals」（goal-store.ts:510）⇒
  GOAL 一经 I2 关闭，其名下全部 AC 一起离开复验域，此后判据变假无人报红。


  实证一（peer 提供，本会话独立复核）：GOAL-001 于 2026-09-07T12:29:05Z 翻 achieved；翻转前 796 轮中 658
  轮评估过其 AC，翻转后 2311 轮中仅 1 轮（应为 flip 当轮本身）。


  实证二（本会话新发现，更致命）：GOAL-007 的整个目的是「done 任务的判据后来变假时，没有任何机制会重新评估」，其解法 AC-188
  逐字写「三例的长期保证已上移为 goal 层【在域】AC，且各带非空 criterion（能被每轮重评估）」。而 AC-188/189/190 末次被评估
  = 2026-09-07T20:21:30.836Z，正是 GOAL-007 翻 achieved 的那一刻；此后仍有 criteria 的轮 1419
  个里评估次数 = 0（口径：ts 严格晚于末次评估时刻且该轮 criteria 非空；⛔ 2220 是全账本有 criteria
  的轮次【总数】，不是「此后」——本条初稿曾误用该数，由驱动 GOAL-009 的 peer 会话指出后于同日更正） ⇒「长期保证从 task 层上移
  goal 层」只是把同一个缺陷换了一层楼，AC-188 标题里「能被每轮重评估」这句现在是假的。


  为何不能全靠套件下沉：能在 hermetic 环境判定的常设不变式应下沉套件（AC-182/183/187
  先例，plugin/test/goal-invariants-standing.test.mjs）；但必须读生产载体的判据（如 GOAL-009 的
  AC-214「交付证据必须新鲜」）写进套件会让套件数据依赖、变 flaky ⇒ 需要一个不随 GOAL 关闭而消失的复验域。两者都要，不是二选一。


  为何须显式声明而非无差别放宽作用域：现有 51 条 achieved AC，按实测单条 gate 成本（GOAL-009 的 7 条共 4.98s ≈
  0.71s/条）全跑一遍约 36–50 秒/轮，超过 drivers.yml 的 goal.interval_ms=30000（30 秒）轮间隔。
statusLog:
  - at: 2026-09-09T11:45:37.240Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---

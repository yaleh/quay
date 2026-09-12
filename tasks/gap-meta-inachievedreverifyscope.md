---
id: gap-meta-inachievedreverifyscope
title: AC-217 常设不变式被冻结在复验域外：GOAL-014 零 AC 激活而零信号——把 long-term 声明落到字段上
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
AC-217（任何 draft/active GOAL 至少一条 AC）自身声明「判据仍能取假：任何无 AC 的 GOAL 一旦进入 draft/active 即报红」，但其 long-term 字段从未落成、其 goal GOAL-010 已 achieved ⇒ 按 inAchievedReverifyScope（activeGoalIds.has(goal) || longTerm===true）它早已离开 I5 复验域，判据自 2026-09-09 起不再重跑；本轮读数 goals=[GOAL-014 active] 而 criteria=[]（GOAL-014 名下无任何 AC 记录）、divergences=[] —— 该不变式正被违反，而违反产生零信号（divergence 只对【已存在】的 AC 计算，零 AC 的目标结构上报不出任何东西）。修 = 把已由人 2026-09-09 裁定②（记在 AC-217 自己的 origin 里）称为「不变式」的裁定落到 long-term 字段（goal-store write --long-term true 是现成的机械写路径），不新建机制。

本轮读数（criteria）= `[]`，采于 2026-09-12T00:40:39Z，由 meta-driver 机械采集。
⚠️ 机制词 `inAchievedReverifyScope` 命中【已完成】任务：gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared.md[done]、gap-meta-computegoalgaps.md[done]、gap-meta-rungoalround.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --reverify-scope | python3 -c 'import json,sys;d=json.load(sys.stdin);e=[x for x in d.get("inScope",[]) if str(x.get("id"))=="AC-217"];sys.exit(0 if (e and e[0].get("longTerm") is True) else 1)'` ⇒ AC-217 回到 I5 复验域（inScope 含 AC-217 且 longTerm=true）⇒ goal-driver 每轮重跑其判据；因 GOAL-014 当前无 AC，它应转 FAIL——违反从「冻结在 achieved、无人看见」变成可见的 achieved-but-failing。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `goals/AC-217-每个活跃-goal-至少有一条-ac-活跃目标无退出条件不可判定达成.md`
- `tasks/gap-meta-inachievedreverifyscope.md`
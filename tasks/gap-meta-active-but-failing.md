---
id: gap-meta-active-but-failing
title: computeDivergences has no branch for status=active ∧ verdict=fail — a
  committed, measurably-failing AC produces no divergence at all
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
plugin/scripts/meta-driver.ts:495-504 skips non-commitment statuses, then covers active+pass (pass-but-unflipped), achieved+fail (achieved-but-failing) and any not-evaluated, but status=active ∧ verdict=fail falls through every branch and emits nothing — so this round's `divergences` is [] while AC-936 (status=active, verdict=fail, the only unachieved AC of the only active goal) has held `fail` for 290 consecutive `timeSeries` rounds (crossed:true), and it is the exact same class of silent fall-through that the `not-evaluated` branch above was added to fix.

本轮读数（divergences）= `[]`，采于 2026-11-08T10:45:02Z，由 meta-driver 机械采集。
涉及机制关键词：`active-but-failing`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "const m = await import('./plugin/scripts/meta-driver.ts'); const d = m.computeDivergences([{id:'AC-T', title:null, goal:'GOAL-T', status:'active', criterion:'false', verdict:'fail', reason:'exit 1'}]); if (!Array.isArray(d) || d.length !== 1 || d[0].kind !== 'active-but-failing') { console.error(JSON.stringify(d)); process.exit(1); } console.log('ok');"` ⇒ computeDivergences returns exactly one divergence of kind `active-but-failing` for an active AC whose criterion fails (today it returns [], verified), and DIVERGENCE_HANDLER_KIND gains a matching entry — the Record<DivergenceKind,string> type makes the union addition fail to compile until the handler mapping is also decided.

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-active-but-failing.md`
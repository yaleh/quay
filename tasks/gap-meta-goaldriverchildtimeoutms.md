---
id: gap-meta-goaldriverchildtimeoutms
title: Goal-gate child is SIGKILLed at its outer bound before writing a verdict
  — AC-911 has been unmeasured for 13 rounds
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`goal-store gate AC-911` is killed at the driver's derived 75000ms bound (60s inner + 15s grace) on 13 consecutive rounds, so a one-line `grep | wc -l` criterion has never produced pass or fail; the instrument, not the criterion's truth, is the failure — and nothing escalates a standing AC whose verdict stays `not-evaluated`.

本轮读数（criteria.AC-911.verdict）= `"not-evaluated"`，采于 2026-10-21T04:08:39Z，由 meta-driver 机械采集。
⚠️ 机制词 `goalDriverChildTimeoutMs` 命中【已完成】任务：gap-cross-project-replay-verify-goal-timeout-and-anti-drift-fixes-on-claudecodeui-and-quay-fleet.md[done]、gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node -e 'const fs=require("fs");const p=".quay/gate-events.jsonl";if(!fs.existsSync(p)){console.error("no gate ledger");process.exit(1)}const rows=fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean).filter(e=>e&&e.item_id==="AC-911");if(rows.length===0){console.error("no AC-911 gate event — the child never reached appendGateEvent");process.exit(1)}const v=rows[rows.length-1].verdict;if(v!=="pass"&&v!=="fail"){console.error("last AC-911 verdict is "+v);process.exit(1)}console.log("definitive verdict: "+v)'` ⇒ A definitive (pass or fail) gate event for AC-911 exists in the production ledger. Today it exits 1 with 'no AC-911 gate event', because the child is SIGKILLed at the driver's bound before it ever appends one; after the repair the same command exits 0 carrying the real verdict.

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `packages/quay/src/core/goal-store.ts`
- `plugin/scripts/meta-driver.ts`
- `packages/quay/test/goal-store.test.mjs`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-goaldriverchildtimeoutms.md`
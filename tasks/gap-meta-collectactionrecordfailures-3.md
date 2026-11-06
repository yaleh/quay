---
id: gap-meta-collectactionrecordfailures-3
title: action-failure reading reports a clean state from a zero-record carrier
  that predates the extractor fix
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
This round `actionRecordFailures` = {state:"none", recordsScanned:0, reason:null, scannedAt:"2026-11-06T00:05:20.357Z"}, but `aggregateActionFailures` returns `none` for an empty record array (zero records is shaped exactly like "examined and clean" — hard rule 3b), and that zero-record carrier was produced 18.8 h BEFORE the extractor fix `4b6f9692e` ("read meta-cc's projected error_text", committed 2026-11-06T18:52Z → 02:52+08:00); `collectActionRecordFailures` still treats it as fresh because freshness is `scan_ttl` (24h) from `scannedAt` alone, with no notion of which extractor produced it ⇒ the reading is doubly unearned yet reads as green.

本轮读数（actionRecordFailures）= `{"state":"none","aggregates":[],"reason":null,"scannedAt":"2026-11-06T00:05:20.357Z","scanMs":57191,"since":null,"thresholdSessions":2,"recordsScanned":0}`，采于 2026-11-06T20:04:49Z，由 meta-driver 机械采集。
⚠️ 机制词 `collectActionRecordFailures` 命中【已完成】任务：gap-meta-collectactionrecordfailures-2.md[done]、gap-meta-collectactionrecordfailures.md[done]、gap-meta-locatemetaccmcp.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "import { aggregateActionFailures } from './plugin/scripts/meta-driver.ts'; const empty = aggregateActionFailures([], { minSessions: 2 }); if (empty.state !== 'not-evaluated') { console.error('empty corpus reported as ' + empty.state); process.exit(1); } const hit = aggregateActionFailures([{sessionId:'a',signature:'s',example:'x',ts:null},{sessionId:'b',signature:'s',example:'x',ts:null}], { minSessions: 2 }); if (hit.state !== 'crossed') { console.error('two-session signature reported as ' + hit.state); process.exit(1); } console.log(JSON.stringify({empty: empty.state, crossed: hit.state}));"` ⇒ An empty corpus yields `not-evaluated` with a named reason (never `none`), while two sessions sharing one signature still yields `crossed` — so "read nothing" and "examined, clean" stop sharing a shape without the instrument going vacuous. Also stamp the scan carrier with the producing extractor's identity so a carrier written by a superseded implementation is not served as fresh.

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-collectactionrecordfailures-3.md`
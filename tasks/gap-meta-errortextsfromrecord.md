---
id: gap-meta-errortextsfromrecord
title: "meta-driver action-record reading is a false clean: extractor drops
  meta-cc's `error_text` field"
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`actionRecordFailures.state` reads `none` with `recordsScanned: 0` after a 57s full-corpus scan, but the corpus does return errors: `errorTextsFromRecord()` in meta-driver.ts only accepts `message.content[].is_error===true` or a string `rec.error`, while meta-cc's `query_session_signals type=errors` returns records shaped `{category, error_text, session_id, timestamp, tool_name}`. Every record is silently skipped, so the whole cross-session-repeated-failure class reads as CLEAN (hard rule 3b's exact mirror: read the input, understood zero, reported 'checked and nothing found').

本轮读数（actionRecordFailures.state）= `"none"`，采于 2026-11-06T18:36:24Z，由 meta-driver 机械采集。
涉及机制关键词：`errorTextsFromRecord`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "import { extractActionFailureRecords, aggregateActionFailures } from './plugin/scripts/meta-driver.ts'; const payload={data:[{category:'bash_exit_code',error_text:'Exit code 1\nls: boom',session_id:'s1',timestamp:'2026-11-06T00:00:00Z',tool_name:'Bash'},{category:'bash_exit_code',error_text:'Exit code 1\nls: boom',session_id:'s2',timestamp:'2026-11-06T00:00:01Z',tool_name:'Bash'}]}; const recs=extractActionFailureRecords(payload); if(!recs||recs.length<2){console.error('extractor yielded '+JSON.stringify(recs)+' for a real meta-cc type=errors payload');process.exit(1)} const agg=aggregateActionFailures(recs,{minSessions:2}); if(agg.state!=='crossed'){console.error('aggregate state '+agg.state);process.exit(1)} console.log(JSON.stringify({records:recs.length,sessions:agg.aggregates[0].sessions,state:agg.state}))"` ⇒ The extractor pulls both records out of the real `{data:[{error_text,…}]}` transport shape and aggregation reaches `crossed` at min_sessions=2; today it extracts `[]`. After landing, the next meta round's `recordsScanned` must be > 0 against the live corpus (this criterion deliberately uses the captured real shape so it is runnable in a task worktree, where meta-cc's project lookup has no sessions).

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-errortextsfromrecord.md`
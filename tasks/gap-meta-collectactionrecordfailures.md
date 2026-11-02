---
id: gap-meta-collectactionrecordfailures
title: Activate the action-record failure aggregation reading (min_sessions +
  scan_ttl)
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
Reading actionRecordFailures.state is unthresholded and thresholdSessions is null, and its scan has not refreshed since 2026-09-12: the seventh meta-driver reading was shipped by a now-done task but .quay/config.yml has no action_record_failures section, so minSessions and scanTtlMs are both null and the instrument can never emit crossed/none.

本轮读数（actionRecordFailures.state）= `"unthresholded"`，采于 2026-11-02T20:17:14Z，由 meta-driver 机械采集。
涉及机制关键词：`collectActionRecordFailures`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --experimental-strip-types -e 'import("./plugin/scripts/meta-driver.ts").then(m=>{const c=m.readActionRecordConfig(process.cwd());if(c.minSessions===null||c.scanTtlMs===null){console.error("action_record_failures unactivated: "+JSON.stringify(c));process.exit(1)}console.log("activated: "+JSON.stringify(c))}).catch(e=>{console.error(String(e));process.exit(1)})'` ⇒ The main checkout .quay/config.yml gains action_record_failures.min_sessions (>=1) and scan_ttl, so readActionRecordConfig reports both non-null and the production reading leaves the unthresholded state.

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `.quay/config.yml`
- `tasks/gap-meta-collectactionrecordfailures.md`
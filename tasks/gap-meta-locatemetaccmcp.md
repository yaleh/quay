---
id: gap-meta-locatemetaccmcp
title: locateMetaCcMcp misses meta-cc's moved install path — action-record scan
  stale for 52 days
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
actionRecordFailures scan fails because locateMetaCcMcp has no search path for ~/.local/share/meta-cc/bin (meta-cc's current install location), so the reading keeps serving a 52-day-stale carrier instead of a fresh scan.

本轮读数（actionRecordFailures.reason）= `"scan-failed: meta-cc-mcp not found (set QUAY_META_CC_MCP or install meta-cc) (served stale carrier scannedAt=2026-09-12T01:40:29.297Z)"`，采于 2026-11-02T22:36:24Z，由 meta-driver 机械采集。
⚠️ 机制词 `locateMetaCcMcp` 命中【已完成】任务：gap-meta-collectactionrecordfailures-2.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "const m=await import('./plugin/scripts/meta-driver.ts');const fs=await import('node:fs');const b=m.locateMetaCcMcp();if(!b||!fs.existsSync(b)){console.error('locateMetaCcMcp unresolved: '+b);process.exit(1)}console.log('located: '+b)"` ⇒ locateMetaCcMcp resolves an existing meta-cc-mcp binary on this machine (currently returns null => scan-failed)

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-locatemetaccmcp.md`
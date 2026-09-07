---
id: gap-meta-driver-source-refresh
title: Resident drivers self-refresh when driver-filters.ts changes (end AC-184
  stale-writer recurrence)
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
AC-184 fails: a resident promotion/worker driver predates driver-filters.ts's last commit and runs stale sync/filter code; no mechanism auto-refreshes drivers on source change, so the failure recurs after every driver-filters.ts commit.

本轮读数（criteria.AC-184.verdict）= `"fail"`，采于 2026-09-07T05:04:55Z，由 meta-driver 机械采集。
涉及机制关键词：`driver-source-refresh`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --experimental-strip-types --test plugin/test/driver-runtime.test.mjs && grep -qE 'respawn|refresh|mtime' plugin/test/driver-runtime.test.mjs` ⇒ A driver-runtime test proves the supervisor respawns the driver when driver-filters.ts advances past the running driver, so resident drivers self-refresh and AC-184 stops failing after every commit.

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/test/driver-runtime.test.mjs`
- `tasks/gap-meta-driver-source-refresh.md`
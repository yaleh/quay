---
id: gap-meta-goal-supervisor
title: goal driver (kind=goal) supervisor+driver dead — restore the goal store's
  resident consumer and its keep-alive path
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
goal driver supervisor+driver are both dead (alive:0, last_record_ts 05:56Z, staleSecs=3116) — the goal store's only resident consumer is offline and blocks active AC-185's goal-round.jsonl production; no path restarts a dead goal supervisor (start-drivers.ts covers only promotion+worker).

本轮读数（drivers.goal.running）= `false`，采于 2026-09-07T06:47:04Z，由 meta-driver 机械采集。
涉及机制关键词：`goal-supervisor`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --experimental-strip-types packages/quay/bin/quay.ts driver status --kind goal --json 2>/dev/null | grep -q '"alive":1' && [ $(( $(date +%s) - $(stat -c %Y .quay/goal-round.jsonl 2>/dev/null) )) -lt 600 ]` ⇒ goal driver reports alive:1 AND .quay/goal-round.jsonl mtime is within the last 600s (resident consumer restored and producing fresh rounds).

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/start-drivers.ts`
- `plugin/test/start-drivers.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-meta-goal-supervisor.md`
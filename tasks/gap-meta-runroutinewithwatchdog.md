---
id: gap-meta-runroutinewithwatchdog
title: quality-gate-driver heartbeat frozen again after caller-side watchdog fix
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
drivers.quality alive (supervisorAlive+driverAlive=true) but .quay/quality-round.jsonl last record 2026-09-08T03:32:03Z (staleSecs=10279, ~342 missed 30s heartbeats) — the resident loop froze again AFTER runRoutineWithWatchdog landed (6a0d2a47e 00:59Z, task done 02:40Z); a Promise.race timer cannot fire while the event loop is synchronously blocked, so the production hang shape still freezes the heartbeat and the supervisor never respawns a live-but-frozen process.

本轮读数（drivers.quality.staleSecs）= `10279`，采于 2026-09-08T06:23:12Z，由 meta-driver 机械采集。
涉及机制关键词：`runRoutineWithWatchdog`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `before=$(wc -l < .quay/quality-round.jsonl); sleep 45; after=$(wc -l < .quay/quality-round.jsonl); [ "$after" -gt "$before" ]` ⇒ quality driver heartbeat (.quay/quality-round.jsonl) gains a new record within ~45s, proving the resident loop is no longer frozen.

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/quality-gate-driver.ts`
- `tasks/gap-meta-runroutinewithwatchdog.md`
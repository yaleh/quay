---
id: gap-meta-outer-driver-2
title: Outer driver not running — restart it so the landed start-drivers.ts
  wiring activates
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
drivers.outer.running=false and carrierRecords=0, the only of 6 registered kinds not running; gap-meta-outer-driver wired outer into start-drivers.ts DRIVER_KINDS but the startup planner was never re-run, so outer was never started (liveness: supervisor_alive=0, deaths=none).

本轮读数（drivers.outer.running）= `false`，采于 2026-09-10T16:51:49Z，由 meta-driver 机械采集。
⚠️ 机制词 `outer-driver` 命中【已完成】任务：DIR-015.md[done]、DIR-017.md[done]、DIR-018.md[done]、DIR-019.md[done]、DIR-027.md[done]、gap-meta-outer-driver.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `test -s .quay/outer-round.jsonl` ⇒ outer driver is running in the main checkout and its production carrier .quay/outer-round.jsonl has at least one round record

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/start-drivers.ts`
- `plugin/scripts/driver-runtime.ts`
- `tasks/gap-meta-outer-driver-2.md`
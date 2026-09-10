---
id: gap-meta-outer-driver
title: Wire outer-driver into the canonical startup set — done kind (gap-ac143)
  running nowhere
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
drivers.outer is the only one of 6 registered driver kinds not running (running=false, carrierRecords=0); gap-ac143 is done but its AC1 (production carrier ≥N records) is unfulfilled, and start-drivers.ts DRIVER_KINDS omits outer.

本轮读数（drivers.outer.running）= `false`，采于 2026-09-10T15:30:42Z，由 meta-driver 机械采集。
⚠️ 机制词 `outer-driver` 命中【已完成】任务：DIR-015.md[done]、DIR-017.md[done]、DIR-018.md[done]、DIR-019.md[done]、DIR-027.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/start-drivers.test.mjs && test -s .quay/outer-round.jsonl` ⇒ the startup planner test passes with outer among the started kinds, and the outer driver's production carrier has at least one round record

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/start-drivers.ts`
- `plugin/test/start-drivers.test.mjs`
- `tasks/gap-meta-outer-driver.md`
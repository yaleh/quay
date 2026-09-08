---
id: gap-meta-quality-gate-driver
title: quality-gate-driver loop freezes on unbounded LLM-judge spawn (carrier
  frozen ~3.9h)
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
quality-gate-driver spawns LLM judges via runAsync(timeoutMs=Infinity) with no caller-side watchdog, so a hung claude child hangs the resident loop; the process stays alive so the supervisor never respawns it, and .quay/quality-round.jsonl is frozen while running=true.

本轮读数（drivers.quality.staleSecs）= `14098`，采于 2026-09-08T00:38:16Z，由 meta-driver 机械采集。
⚠️ 机制词 `quality-gate-driver` 命中【已完成】任务：gap-ac144-quality-gate-shape-separated-driver.md[done]、gap-drain-on-routine-driver-empties-round-and-respawn-loops.md[done]、gap-goal-driver-mechanical-ring.md[done]、gap-meta-kind-violates-spec-no-new-probe-driver-kind.md[done]、gap-meta-round-log-rel.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `node --experimental-strip-types --test plugin/test/quality-gate-driver-loop-watchdog.test.mjs >/dev/null 2>&1` ⇒ a never-resolving routine no longer freezes the loop heartbeat (per-routine watchdog bounds each routine)

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/test/quality-gate-driver-loop-watchdog.test.mjs`
- `tasks/gap-meta-quality-gate-driver.md`

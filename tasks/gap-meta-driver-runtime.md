---
id: gap-meta-driver-runtime
title: restart stale resident promotion+worker drivers — both predate
  driver-filters.ts @ 8b230e7
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
AC-184 fires: promotion driver (started 00:42:55Z) and worker driver (03:40:20Z) both predate driver-filters.ts's last commit (04:03:55Z, needs-human cause + ff-latch logic) — production runs stale driver code.

本轮读数（criteria.AC-184.verdict）= `"fail"`，采于 2026-09-07T10:46:48Z，由 meta-driver 机械采集。
⚠️ 机制词 `driver-runtime` 命中【已完成】任务：gap-a13-a20-stale-carrier-after-worker-driver-takeover.md[done]、gap-ac143-observability-ledger-closing-driver.md[done]、gap-ac144-quality-gate-shape-separated-driver.md[done]、gap-ac151-two-level-driver-layer-landing.md[done]、gap-ac155-config-merge-control-state-split-event-polling.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `last=$(git log -1 --format=%ct -- plugin/scripts/driver-filters.ts); for kind in promotion worker; do pids=$(pgrep -f "scripts/${kind}-driver.ts"); [ -n "$pids" ] || exit 1; for p in $pids; do [ "$(stat -c %Y /proc/$p 2>/dev/null)" -ge "$last" ] || exit 1; done; done` ⇒ every resident promotion/worker driver process was (re)started at/after driver-filters.ts's latest commit — the staleness check now passes.

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/driver-runtime.ts`
- `tasks/gap-meta-driver-runtime.md`
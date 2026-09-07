---
id: gap-meta-ac-184
title: AC-184 stale-driver guard checks only the lowest pid — a stale
  promotion-driver still writes old-shape not-ff events and AC-183 fails
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
A promotion-driver launched 2026-09-06T01:47Z (pid 3696202, supervisor 3696193, run-id pm-prod-1788659270 — ~11h before driver-filters.ts added the `benign` field at 2026-09-06T12:43Z) is still alive and writing `doc-develop-sync-not-ff` events without `benign`, so AC-183 fails; AC-184's guard (`pgrep -f 'scripts/${kind}-driver.ts' | sort -n | head -1`) inspects only one pid and passed by checking a transient fresh sibling while the stale resident kept writing.

本轮读数（syncHealth.notFf）= `130`，采于 2026-09-07T00:20:24Z，由 meta-driver 机械采集。
⚠️ 机制词 `AC-184` 命中【已完成】任务：gap-meta-syncdeveloptodoc.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `last=$(git log -1 --format=%ct -- plugin/scripts/driver-filters.ts); pgrep -qf 'scripts/promotion-driver.ts' || exit 1; for p in $(pgrep -f 'scripts/promotion-driver.ts'); do [ "$(stat -c %Y /proc/$p 2>/dev/null)" -ge "$last" ] || exit 1; done` ⇒ Every live promotion-driver process is newer than the driver-filters.ts last commit — no stale writer remains and the guard cannot be flaked by a fresh sibling.

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `goals/AC-184-driver-driver.md`
- `tasks/gap-meta-ac-184.md`
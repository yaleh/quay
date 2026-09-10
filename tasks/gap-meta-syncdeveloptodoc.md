---
id: gap-meta-syncdeveloptodoc
title: semantic-ff-failed 事件不落 detail：常驻 driver 跑旧代码且无检测
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra:
  acceptance: node --experimental-strip-types --test plugin/test/driver-filters.test.mjs
---
## Finding
语义兜底 ff-push 近窗 3 次失败（semanticFfFailed=3）且失败原因未落痕——载体 11 条 semantic-ff-failed 事件全部无 detail 字段；根因是 author 落后 develop（notFfBehind=6）使常驻 promotion-driver 加载旧 driver-filters.ts，detail 捕获修复（7b59cc66c）未在生产激活，且无机制检测「修复已落地但 driver 跑旧代码」。

本轮读数（syncHealth.semanticFfFailed）= `3`，采于 2026-09-08T14:19:09Z，由 meta-driver 机械采集。
⚠️ 机制词 `syncDevelopToDoc` 命中【已完成】任务：gap-main-manager-doc-doc-only-ff-only-tracking.md[done]、gap-meta-ac-184.md[done]、gap-meta-commitgoalfile.md[done]、gap-meta-syncdeveloptodoc.md[done]、gap-sync-develop-to-doc-not-doc-silent-noop.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --experimental-strip-types --test plugin/test/driver-filters-ff-detail.test.mjs` ⇒ 强制 ffPushToDevelop 失败时 semanticSyncDocToDevelop 写出的 semantic-ff-failed 事件携带非空 detail，失败原因可归因

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/driver-filters.ts`
- `plugin/scripts/promotion-driver.ts`
- `plugin/test/driver-filters-ff-detail.test.mjs`
- `tasks/gap-meta-syncdeveloptodoc.md`
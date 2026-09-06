---
id: gap-meta-syncdeveloptodoc
title: 重启 promotion 常驻 driver——早于 driver-filters.ts 最近提交启动，运行无 benign 字段的陈旧
  syncDevelopToDoc
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
AC-184 fail：promotion 常驻 driver 早于 driver-filters.ts 最近提交启动（worker 已新鲜），仍执行旧 syncDevelopToDoc，写出的 doc-develop-sync-not-ff 事件缺 benign 字段 ⇒ AC-183 亦 fail ⇒ syncHealth（notFf=132 / ffSynced=0 / semanticBegin=0）无法区分良性 ahead-only 与真分叉。修法=重启 promotion driver 加载新代码。

本轮读数（syncHealth.notFf）= `132`，采于 2026-09-06T23:39:36Z，由 meta-driver 机械采集。
⚠️ 机制词 `syncDevelopToDoc` 命中【已完成】任务：gap-main-manager-doc-doc-only-ff-only-tracking.md[done]、gap-meta-commitgoalfile.md[done]、gap-meta-syncdeveloptodoc.md[done]、gap-sync-develop-to-doc-not-doc-silent-noop.md[done]、gap-sync-trigger-divergence-detection-bidirectional.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node packages/quay/src/goal-store.ts gate AC-184` ⇒ AC-184 通过：promotion 与 worker 常驻 driver 启动时刻均不早于 driver-filters.ts 最近提交时刻

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/driver-filters.ts`
- `tasks/gap-meta-syncdeveloptodoc.md`
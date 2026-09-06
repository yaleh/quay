---
id: gap-meta-syncdeveloptodoc
title: syncDevelopToDoc 事件落痕丢弃归因数据——ff-error 吞 git 错误、not-ff 缺 ahead/behind
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
ff-error 的 merge catch 用 stdio:'ignore' 丢 git stderr（44 条全 phase=merge 不可归因），not-ff 不记已算出的 ahead/behind 计数（30 条分叉量不可解读）

本轮读数（syncHealth.ffError）= `44`，采于 2026-09-06T12:21:48Z，由 meta-driver 机械采集。
⚠️ 机制词 `syncDevelopToDoc` 命中【已完成】任务：gap-main-manager-doc-doc-only-ff-only-tracking.md[done]、gap-sync-develop-to-doc-not-doc-silent-noop.md[done]、gap-sync-trigger-divergence-detection-bidirectional.md[done]、gap-task-ops-consolidate-driver-frontmatter-writers.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `grep -n 'doc-develop-sync-ff-error' plugin/scripts/driver-filters.ts | grep -qE 'stderr|gitError|capturedErr' && grep -n 'doc-develop-sync-not-ff' plugin/scripts/driver-filters.ts | grep -qE 'ahead|behind'` ⇒ ff-error 事件携带 git 错误细节、not-ff 事件携带 ahead/behind——syncHealth 的失败与分叉读数可归因

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
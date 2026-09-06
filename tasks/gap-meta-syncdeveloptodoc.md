---
id: gap-meta-syncdeveloptodoc
title: syncDevelopToDoc 事件落痕丢弃归因数据——ff-error 吞 git 错误、not-ff 缺 ahead/behind
status: needs-human
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra:
  acceptance: node --experimental-strip-types --test plugin/test/driver-filters.test.mjs
---
## Finding
ff-error 的 merge catch 用 stdio:'ignore' 丢 git stderr（44 条全 phase=merge 不可归因），not-ff 不记已算出的 ahead/behind 计数（30 条分叉量不可解读）

本轮读数（syncHealth.ffError）= `44`，采于 2026-09-06T12:21:48Z，由 meta-driver 机械采集。
⚠️ 机制词 `syncDevelopToDoc` 命中【已完成】任务：gap-main-manager-doc-doc-only-ff-only-tracking.md[done]、gap-sync-develop-to-doc-not-doc-silent-noop.md[done]、gap-sync-trigger-divergence-detection-bidirectional.md[done]、gap-task-ops-consolidate-driver-frontmatter-writers.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

**落地记录（2026-09-06）**：工作已在 develop 的 `55805b257` 落地，改的是既有机制自身（`syncDevelopToDoc` / `writeDocDevelopSyncEvent`），未新建并行机制：
- `doc-develop-sync-ff-error` 事件：merge catch 改用 `stdio: ["ignore","ignore","pipe"]` 捕获 git stderr，写入事件的 `detail` 字段 ⇒ 44 条 phase=merge 从此可归因。
- `doc-develop-sync-not-ff` 事件：补 `ahead` / `behind` / `benign` 三字段，其中 `benign` 由 `behind === 0` 派生（不是另一个自述值）⇒ 可区分「只领先（良性：doc 刚提交、无物可拉）」与「既领先又落后（真分叉）」。

## 为什么这条曾进 needs-human（立案模板缺陷，非工作本身）
本任务由 meta-driver autoDrive 通道自动立案，连撞 3 次重试上限后翻 needs-human。真因**不是工作做不了**，而是立案模板的两个缺陷（两者都已在 meta-driver 侧修好）：
1. **Touches 硬编码错文件**：模板写死 `plugin/scripts/meta-driver.ts`，而真正的落点是 `plugin/scripts/driver-filters.ts`。Touches 是 anti-drift 的授权面 ⇒ worker 在结构上不可能改对文件，重试多少次都不会合格。
2. **AC 是行耦合的 grep**：原判据 `grep -n 'doc-develop-sync-ff-error' … | grep -qE 'stderr|gitError|capturedErr'` 要求两个 token 出现在**同一行源码**上；实现分两行落地 ⇒ **正确实现也判 FAIL**。它测的是源码排版，不是行为。
⇒ 本次把 Touches 换成真实授权面、把 AC 换成行为级判据（读事件对象本身）。

## AC（draft）
- [ ] `node --experimental-strip-types --test plugin/test/driver-filters.test.mjs` ⇒ exit 0。该文件已有行为级断言直接读 `doc-develop-sync-not-ff` **事件对象**：`Number.isInteger(last.ahead) && last.ahead >= 1`、`Number.isInteger(last.behind)`、`last.benign === (last.behind === 0)`（在「AC2 — 分叉 guard」用例内）——判的是事件携带什么，不是源码怎么排版。
- [ ] 换判据的理由记录在案：原 AC 把两个 token 耦合到同一行源码上，实现分两行 ⇒ 正确实现恒 FAIL；这类判据测的是排版而非行为，属无效判据，故整条替换而不是放宽。

## DoD（draft）
- [ ] 上面的行为级判据实跑通过（本轮实跑，非转述），且它能取假：把 not-ff 事件的 `ahead`/`behind` 去掉、或把 `benign` 改成与 `behind` 无关的自述值，该用例立即红。
- [ ] 修的是既有机制 `syncDevelopToDoc` / `writeDocDevelopSyncEvent` 的落痕字段本身，⛔ 未在其旁新建并行机制。

## Touches
- `plugin/scripts/driver-filters.ts`
- `plugin/test/driver-filters.test.mjs`
- `tasks/gap-meta-syncdeveloptodoc.md`

## Needs-Human

**执行 2026-09-06T12:45:22.711Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
- **已消解（2026-09-06）**：真因是上面「为什么这条曾进 needs-human」一节记录的立案模板两缺陷，不是这条工作本身有问题。

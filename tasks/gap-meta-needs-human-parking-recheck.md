---
id: gap-meta-needs-human-parking-recheck
title: needs-human 停放理由失效后无任何产物上报：判据修好、任务仍停、goal AC 每轮红
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
tasks/gap-semantic-admission-contract-module.md 因 unsatisfiableUnannotatedAc 被机械翻成 needs-human，而该判据已修复（tasks/gap-meta-declaresunsatisfiablebyexecutor done；当前 judgeUnsatisfiableUnannotatedAc 对该任务体返回 clean），可是 needs-human 被明确裁定禁止机械再入队（driver-filters.ts 人裁「本来就不应该有『可机械再入队』的路径」），于是唯一的产物应是一条「停放理由已失效」的上报——它不存在：needs-human-recheck.ts 以零调用者归档，manager-tick-readings 无该面，结果 AC-919 连续 42 轮 fail 而人无从察觉

本轮读数（timeSeries.2.count）= `42`，采于 2026-10-22T15:04:57Z，由 meta-driver 机械采集。
涉及机制关键词：`needs-human-parking-recheck`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/needs-human-parking-recheck.test.mjs` ⇒ 只读探测器对每个 needs-human 任务复跑其记录里的机械停放判据，只报「该判据今日已 clean 而任务仍停放」的那些（判据仍发火的不报、非机械原因停放的不报、读不懂输入记 not-evaluated 而非 clean），并接到一个每轮真跑的活消费者上；全程不改 status，遵守禁止机械再入队的裁定

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/needs-human-parking-recheck.ts`
- `plugin/test/needs-human-parking-recheck.test.mjs`
- `plugin/scripts/promotion-driver.ts`
- `plugin/scripts/capability-catalog.sh`
- `docs/proposals/quay-product-outline.md`
- `tasks/gap-meta-needs-human-parking-recheck.md`
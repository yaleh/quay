---
id: gap-meta-goal-triage-fresh-draft-not-retire
title: goal-driver 分诊默认分支把无任务牵引的 draft AC 判 retire——改 hold 并补建 AC-219 判据测试
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
triageDraftAc 默认分支（goal-driver.ts:543）把结构完备、goal 锚合法、criterion 非空、无 posture、无任务牵引的 draft AC 判 retire→needs-human（AC-217/218/219 因此全卡 needs-human，AC-218 已记录同日被误判退役）；AC-219 判据指向的测试 goal-triage-fresh-draft-not-retire.test.mjs 尚未创建，恒 fail

本轮读数（drivers.goal.running）= `true`，采于 2026-09-09T12:16:18Z，由 meta-driver 机械采集。
涉及机制关键词：`goal-triage-fresh-draft-not-retire`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --no-warnings --experimental-strip-types --test plugin/test/goal-triage-fresh-draft-not-retire.test.mjs` ⇒ 刚提案、goal 锚合法、criterion 非空、无 posture、无任务牵引的 draft AC 分诊为 hold/activate 而非 retire→needs-human；AC-219 判据退出码 0

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-triage.test.mjs`
- `plugin/test/goal-triage-fresh-draft-not-retire.test.mjs`
- `plugin/test/goal-triage-no-driver-retire.test.mjs`
- `plugin/test/goal-driver.test.mjs`
- `tasks/gap-meta-goal-triage-fresh-draft-not-retire.md`
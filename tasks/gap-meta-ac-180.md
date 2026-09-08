---
id: gap-meta-ac-180
title: 修复 AC-180 恒绿判据——grep 管道只留 id 行且 goal-store 丢弃 criterion 键，守卫永远无法取假
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
AC-180 判据用 `list --status active | grep -E '"id": "AC-' | grep -c '"criterion": null'` 数「活跃 AC 无判据」数，但首段 grep 只留下 id 行（criterion 键在别的行）、且 goal-store.ts toViewModel 把缺失 criterion 序列化为键被丢弃，两处叠加使计数恒 0、判据恒 pass——13 条 criterion-less 活跃 AC 它一条都测不到。

本轮读数（criteria.23.verdict）= `"pass"`，采于 2026-09-06T14:26:00Z，由 meta-driver 机械采集。
涉及机制关键词：`AC-180`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `if node packages/quay/src/goal-store.ts gate AC-180 >/dev/null 2>&1; then echo 'AC-180 still blind: passes despite criterion-less active ACs' >&2; exit 1; else exit 0; fi` ⇒ 修复后 gate AC-180 必须返回非零（fail），因为它现在能测到 13 条 criterion-less 活跃 AC；修复前它恒 pass（盲目）。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `goals/AC-180-active-ac.md`
- `tasks/gap-meta-ac-180.md`
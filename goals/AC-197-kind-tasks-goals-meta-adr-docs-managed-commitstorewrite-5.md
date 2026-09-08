---
id: AC-197
title: 五 kind 齐备：tasks/goals/meta/adr/docs-managed 全部接线 commitStoreWrite = 5
status: achieved
kind: criterion
goal: GOAL-008
criterion: test "$(grep -l commitStoreWrite packages/quay/src/goal-store.ts
  packages/quay/src/meta-store.ts packages/quay/src/adr-store.ts
  packages/quay/src/document-store.ts packages/quay-native/src/store.ts
  2>/dev/null | wc -l)" -eq 5
expect: 今天读数 0 ⇒ 红。落地后 5（adr 与 docs-managed 是本 AC 新增的两个，人 2026-09-08 裁定 2）。
origin: SPEC §4 声明表 + 人 2026-09-08 裁定「adr / docs-managed 也要有
  commit-after-write」。今天 adr-store.ts 与 document-store.ts 完全没有提交路径（grep commit =
  0），是五个 kind 里唯二写盘不提交的。
---

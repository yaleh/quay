---
id: gap-store-commit-unification-ac197-five-kind-wiring
title: AC-197 五 kind 齐备：五个 store 文件全部调用 commitStoreWrite = 5（adr / docs-managed 新增两个）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-197
---
## Proposal

正本：orchestration/SPEC-store-commit-unification-2026-09-08.md §4 声明表 + §7 AC-197；判据 goals/AC-197-kind-tasks-goals-meta-adr-docs-managed-commitstorewrite-5.md（goal=GOAL-008）。今天读数（已实测，位置判定）：`grep -l commitStoreWrite` 五个 store 文件命中 0 ⇒ 红。adr-store.ts 与 document-store.ts 完全没有提交路径（grep commit = 0），是五 kind 里唯二写盘不提交的；人 2026-09-08 裁定 2 把它们纳入 commit-after-write。落地后 = 5。本任务 = SPEC 阶段 1 的 AC-197 判据面切片：只判「五 store 文件全部调用 commitStoreWrite = 5」这一件事——adr/docs-managed 是新增两个，goal/meta/quay-native store 三处与 AC-195/196（gap-store-commit-unification-stage1 / gap-store-commit-unification-ac196-four-state-return，均 ready）是同一原子改动的不同判据面。阶段 2（传播按读者归位）与阶段 3（驱动侧直写点）范围外。

## Plan

1. 核 AC-197 判据当前读数 = 0：`grep -l commitStoreWrite` 五个 store 文件。
2. adr-store.ts 接线：写盘后调 commitStoreWrite（relPath "adr/ADR-x.md"，propagate "none"，skipIf 字节相同，SPEC §4 声明表），对 failed 落痕。
3. document-store.ts 接线：同 adr（relPath "docs-managed/D-x.md"）。
4. goal-store.ts / meta-store.ts / quay-native/src/store.ts 三处确认已改调 commitStoreWrite（与 AC-195/196 同原子改动；若已由兄弟任务落地则只核 grep 命中，不重做）。
5. 跑 AC-197 判据 = 5。

## Acceptance Criteria

- [x] AC-197 判据本判据：`test "$(grep -l commitStoreWrite packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts packages/quay/src/adr-store.ts packages/quay/src/document-store.ts packages/quay-native/src/store.ts 2>/dev/null | wc -l)" -eq 5`
- [x] adr-store.ts 已接线：`grep -q commitStoreWrite packages/quay/src/adr-store.ts`
- [x] document-store.ts 已接线：`grep -q commitStoreWrite packages/quay/src/document-store.ts`

## Definition of Done

真实落地 = AC-197 判据在生产工作树 = 5（不是「计划里说要接线」，DIR-026 Reading A）：五个 store 文件 `grep -l commitStoreWrite` = 5；并做一次真实写盘往返——经 adr-store 写一个 adr 文件、经 document-store 写一个 docs-managed 文件，`git log -- adr/ docs-managed/` 可见提交消息来自新原语 commitStoreWrite（非旧式路径），且 `git status --porcelain adr/ docs-managed/` 为空（unchanged 不留脏工作树，脏文件会挡 develop→doc ff-only）。

## Touches

- packages/quay/src/adr-store.ts
- packages/quay/src/document-store.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/meta-store.ts
- packages/quay-native/src/store.ts
- packages/quay/test/store-commit.test.mjs
- tasks/gap-store-commit-unification-ac197-five-kind-wiring.md
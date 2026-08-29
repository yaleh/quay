---
id: gap-continue-note-write-inventory-retired
title: continueConflictResolutionNote 的 derived 指令改「outline 冲突取 develop
  版」（--write-inventory 已退役）
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`continueConflictResolutionNote()`（`plugin/scripts/worker-driver.ts:1090`）对 derived 文件（outline §6）的冲突消解指令仍是「apply your own change, then re-run `verify-delivery-surface.ts --write-inventory` to recompute the counts」——但 `--write-inventory` 已退役（`gap-delivery-inventory-check-time-computation` 移除了 §6 快照、改为 check-time 计算，`verify-delivery-surface.ts:502` 报「ERROR: --write-inventory is retired」）。结果是 CONTINUE prompt 会给 outline 冲突的 worker 发「重跑已退役命令」的错误指令，worker 卡住、outline 冲突（ac149/b1/canonical）解不开。

## Plan

1. `worker-driver.ts:1090` 的 derived 指令改为「outline 冲突取 develop 版」——§6 快照已退役、计数 check-time 计算，冲突消解 = `git checkout develop -- docs/proposals/quay-product-outline.md`（或等价「取 mergeTarget 版」），⛔ 不再 `--write-inventory`、⛔ 不手并计数。注释同步（`derived 文件重算` → `outline 冲突取 develop 版`）。
2. 同步测试：`plugin/test/worker-driver.test.mjs` 里对 `continueConflictResolutionNote` 的断言（若有断言含 `write-inventory`，改为断言含「取 develop 版」/「checkout develop」）。

## Acceptance Criteria

- [x] AC1（能取假）：`grep -n 'write-inventory' plugin/scripts/worker-driver.ts` 命中 0（唯一引用已移除）。
- [x] AC2（能取假）：`continueConflictResolutionNote()` 返回串含「取 develop 版」（或 `checkout develop` 指令），且不再含 `--write-inventory`。
- [x] AC3（能取假，单测）：`worker-driver.test.mjs` 对 note 的断言绿（改掉任一 ⇒ 测试红）。

## Definition of Done

CONTINUE prompt 对 outline 冲突给 worker 正确指令（取 develop 版），`--write-inventory` 引用清零，outline 冲突（ac149/b1/canonical）可被 worker 正确消解、fan-in 不再因陈旧指令卡住。

## Touches

- plugin/scripts/worker-driver.ts（continueConflictResolutionNote:1090）
- plugin/test/worker-driver.test.mjs（note 断言同步）
- tasks/gap-continue-note-write-inventory-retired.md（自身）

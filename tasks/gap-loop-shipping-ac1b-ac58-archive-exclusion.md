---
id: gap-loop-shipping-ac1b-ac58-archive-exclusion
title: loop-shipping AC1b 仍红——AC58-retired-clauses.md 历史档案含旧路径引用但未入排除表（owner 任务已 done 但红 persists）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 2026-08-15 13:3xZ 立案——owner 任务 `gap-loop-shipping-ac1b-still-red-live-old-path-ref` status=done 但 AC1b 红在 develop 上仍 persists，能产出≠已产出类）**。

**现象**：`plugin/test/loop-shipping.test.mjs` AC1b「after the move, no live reference to the 5 old paths remains」在 develop 上仍红。实测：`orchestration/archive/AC58-retired-clauses.md` 含 7 处 `orchestration/orchestrator-loop-tick.md` 旧路径引用（lines 492/514 等），`loop-shipping-exclusion-data.mjs` 排除其它 AC58 格式档案（`manager-phase-goal-archive.md` 等）但**未排除 `AC58-retired-clauses.md`**。

**这是【历史档案引用】非【活引用】**：AC58-retired-clauses.md 是退役条款档案，记录被退役内容（含旧路径）——同 `manager-phase-goal-archive.md` / `tick-log.md` 等已排除档案同一类（文档化 DEPLOYED target layout 的活引用，或历史存档的旧路径记录）。parser fan-in（gap-touches-parser-strip-annotation-nested-parens）被此红阻断（全量 suite 恒红）。

**修法**：`loop-shipping-exclusion-data.mjs` 加排除条目 `orchestration/archive/AC58-retired-clauses.md`（历史档案，旧路径引用是文档化记录，非活引用到已移动机制）。⛔ 不改 AC1b 扫描本身（仍必须抓真活引用）。

**判据1**：AC1b 对 AC58-retired-clauses.md 的旧路径引用不再报红（隔离 + 全量 suite）。
**判据2（能取假·真样本）**：修后 `node --test plugin/test/loop-shipping.test.mjs` AC1b 绿；真活引用（如某处真引用了已移动路径的活跃文件）仍红。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 跑 `node --test plugin/test/loop-shipping.test.mjs` 确认 AC1b 红 + actual hits 对象（AC58-retired-clauses.md）。
2. `loop-shipping-exclusion-data.mjs` 加 AC58-retired-clauses.md 排除条目（同 AC58 格式档案先例）。
3. 判据2 能取假：AC1b 绿 + 真活引用仍红。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：AC1b 对 AC58-retired-clauses.md 旧路径引用不再报红（隔离 + 全量）。
- [ ] AC2 判据2 能取假：AC1b 绿；真活引用（活跃文件引用已移动路径）仍红。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] AC58-retired-clauses.md 入排除表（历史档案）+ AC1b 绿 + 真活引用仍红 + 测试绿——parser fan-in 解除阻断。

## Touches

- plugin/scripts/loop-shipping-exclusion-data.mjs（AC58-retired-clauses.md 排除条目）
- plugin/test/loop-shipping.test.mjs（如需要，确认排除生效）
- tasks/gap-loop-shipping-ac1b-ac58-archive-exclusion.md（自身）

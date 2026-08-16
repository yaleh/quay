---
id: gap-touches-multipath-delimiter-coverage-gap
title: flagMultiPathTouchEntries 只测 ' / ' 分隔——'、' 全角分隔的 Touches 复合条目漏检，anti-drift 首次才拦（AC76 fan-in 实证）
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

**（inner 2026-08-16 立案——AC76 fan-in 实证：`touches-parser.ts` 每个 bullet 一个 composite glob，`、` 分隔的两路径条目（`plugin/scripts/a.ts、plugin/scripts/b.ts`）在 anti-drift 处 HARD-FAIL（out-of-declared）。`checkTaskOneEntryOnePath` 的 `flagMultiPathTouchEntries` 只测 `' / '` 分隔符，`'、'`（全角顿号）是覆盖缺口——首个机制是 anti-drift 才拦到后果（作者时检查器没拦）。）**

**现象**：`tasks/gap-ac76-tick-core-retirement-cleanup.md` 的 Touches 曾有两条 `、`-复合 bullet（`slot-refill.ts、fast-mode-telemetry.ts` / `red-on-omission-audit.ts、red-on-omission-audit.test.mjs`），fan-in 的 anti-drift-touches-check HARD-FAIL。`flagMultiPathTouchEntries` 只测 `' / '`（半角斜杠分隔）⇒ `、` 漏检 ⇒ 作者时无红。

**修法**：`flagMultiPathTouchEntries`（及其判定）扩展分隔符集，覆盖 `、`（全角顿号）/ `，`（全角逗号）/ `,`（半角逗号）等多路径分隔——任何 single bullet 含 ≥2 个路径 ⇒ 红。保持现有单路径条目不误报。

**判据1**：`、`-复合 Touches bullet 被作者时检查器标红（不再只靠 anti-drift）。
**判据2（能取假）**：单路径条目不误报；多路径（' / ' 或 '、'）标红。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 flagMultiPathTouchEntries（所在文件：touches 相关检查器/parser）+ 测试。
2. 扩展分隔符集（'、'/'，'/','等），加负控制（单路径不误报）。
3. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：`、`-复合 Touches bullet 作者时标红。
- [ ] AC2 判据2 能取假：单路径不误报；多路径（/ 或 、）标红。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] flagMultiPathTouchEntries 覆盖全角分隔符，`、`-复合条目不再漏检（AC76 fan-in 教训固化）。

## Touches

- plugin/scripts/touches-parser.ts 或 flagMultiPathTouchEntries 所在文件（多路径分隔符扩展）
- 对应测试文件
- tasks/gap-touches-multipath-delimiter-coverage-gap.md（自身）

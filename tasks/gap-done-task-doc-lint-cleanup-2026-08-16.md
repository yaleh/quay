---
id: gap-done-task-doc-lint-cleanup-2026-08-16
title: "清理：15 个 done 任务的文件文档 lint×18（invoke-evidence×10 / contract-line×4 / dispatch-review×2 / measure-no-field×1 / contract-measure-no-name×1）——独立于 suite-fix，非红成因"
status: ready
labels:
  - gap
  - cleanup
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：suite-fix 红基线诊断的副产品（manager 2026-08-16 复算 + 负控制）。

**关键事实（负控制证否）**：这 18 条 `tasks/*.md` 文档 lint 出现在红轮的 failures 里，但**不是红的成因**——
08-15 09:00–13:00 红→绿→红窗口内，这 15 个任务文件**改动 0 次**，绿轮跑时这 18 条原封不动在树里
⇒ 它们是静态门失败时一并打印的附带输出。**修它们不改变门状态**（门的状态由
`direct-to-develop-bypass-check` 决定，见 suite-fix 任务）。

**⇒ 独立清理项**：不并进 suite-fix 的 AC（避免「基线绿」依赖一件无关的事）。这是 15 个
**已完成（status=done）**任务的文档债——机械、低风险。

## Plan

1. 枚举 18 条 lint 所在的 15 个任务文件（invoke-evidence-missing×10 / contract-line-unknown×4 /
   dispatch-review-missing×2 / measure-no-field×1 / contract-measure-no-name×1）。
2. 逐条补齐（Evidence 记录 / Contract 行 / Dispatch review / measure 字段），使文档 lint 清零。
3. 只改已 done 任务的文档段，不改 frontmatter 状态（done 保持 done）。

## Acceptance Criteria

- [ ] AC1: 18 条文档 lint 清零（跑产生它们的检查器，violations=0）。
- [ ] AC2: 只改 done 任务的文档段，status: done 保持不变。
- [ ] AC3: 不依赖 suite-fix 的 bypass-check 门结果——本任务独立达成。

## Definition of Done

- [ ] 15 个 done 任务的文档 lint 全清（机械可核），与 suite-fix 解耦。

## Touches

- tasks/*.md（15 个 done 任务的文件，只改文档段）
- tasks/gap-done-task-doc-lint-cleanup-2026-08-16.md（自身）

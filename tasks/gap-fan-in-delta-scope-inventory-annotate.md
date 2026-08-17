---
id: gap-fan-in-delta-scope-inventory-annotate
title: "delta-scope 存量处置：AC1 枚举出的已 done 但未验证任务逐个标注「落地未经全量轮验证」（从 gap-fan-in-delta-scope-doc-only-skip AC4 拆出）"
status: todo
labels:
  - gap
  - mechanism
parent: gap-fan-in-delta-scope-doc-only-skip
children: []
extra:
  schema: execution
depends_on:
  - gap-fan-in-delta-scope-doc-only-skip
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 22:3xZ（拆分裁定）+ gap-fan-in-delta-scope-doc-only-skip AC4。

**背景**：delta-scope 缺陷（代码经 doc-only-delta 跳过全量进 develop，从未验证）的**存量处置**。父任务的 AC1 会枚举出所有「fullSuiteRan=false ∧ skipReason=doc-only-delta ∧ 从未 fullSuiteRan=true」的任务清单。本任务负责把这些**已 done 但未验证**的任务逐个标注「落地未经全量轮验证」（如 manager 给 AC97 的 2df28ee4 样式），并判定是否需补跑全量轮。

**为什么拆出**：本任务写 `tasks/*.md`（目录级）⇒ 与任何在飞任务 self-touch 冲突 ⇒ 若并入父任务会使父任务永久不可派（见父任务 Touches 拆分说明）。拆出后父任务可派，本任务等真正 0 在飞窗口。

**⛔ 前置**：本任务 `depends_on` 父任务（先有 AC1 确数清单，才有存量标注对象）。

## Acceptance Criteria

- [ ] AC1: 父任务 AC1 枚举出的每个已 done 但未验证任务，其 `tasks/<id>.md` 标注「落地未经全量轮验证」（如 2df28ee4 的 AC97 样式）——标注数 = 父任务 AC1 清单数，可机械核对。
- [ ] AC2: 每个标注同时判定是否需补跑全量轮（读其实际 diff 非 doc 程度决定）——需补跑的列出补跑计划，不需补跑的理由写清。
- [ ] AC3: 标注可 `git log` 追溯（每个被标注任务的提交信息含「未验证」字样）。

## Definition of Done

- [ ] 父任务清单的全部存量任务已标注 + 补跑判定完成。

## Touches

- tasks/*.md（父任务 AC1 清单里的存量任务，逐个加标注）
- tasks/gap-fan-in-delta-scope-inventory-annotate.md（自身）

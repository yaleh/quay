---
id: gap-fan-in-delta-scope-inventory-annotate
title: "delta-scope 存量处置：AC1 枚举出的已 done 但未验证任务逐个标注「落地未经全量轮验证」（从 gap-fan-in-delta-scope-doc-only-skip AC4 拆出）"
status: done
labels:
  - gap
  - mechanism
parent: null
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

**⚠️ 为什么是 sibling 不是 child（manager 2026-08-17 裁定，⛔ 别把它加回 parent）**：本任务对 `gap-fan-in-delta-scope-doc-only-skip` **只有 `depends_on`（排序），没有 parent-child（完成依赖）**。原因是 parent-child 的 done-iff-children 语义与本任务「推迟的后继」身份冲突：本任务写目录级 `tasks/*.md`（global lock），只能在 0 在飞窗口派——若做 child，父任务不能 done ⇒ 恒在飞 ⇒ 本任务恒被锁，死锁。**拆分出「推迟的后继」时用 sibling + depends_on，不用 parent-child**（形态已归入 gap-fan-in-orchestration-bootstrap-self-fix 参考区）。若哪天看到本任务 parent=null 以为漏挂了 parent——这是有意的，别加回去。

## Acceptance Criteria

- [x] AC1: 父任务 AC1 枚举出的每个已 done 但未验证任务，其 `tasks/<id>.md` 标注「落地未经全量轮验证」（如 2df28ee4 的 AC97 样式）——标注数 = 父任务 AC1 清单数，可机械核对。
- [x] AC2: 每个标注同时判定是否需补跑全量轮（读其实际 diff 非 doc 程度决定）——需补跑的列出补跑计划，不需补跑的理由写清。
- [x] AC3: 标注可 `git log` 追溯（每个被标注任务的提交信息含「未验证」字样）。

## Definition of Done

- [x] 父任务 AC1 清单的全部存量任务已逐个标注「落地未经全量轮验证」，标注数 = 清单数可机械核对（AC1）。
- [x] 每个标注同时完成补跑判定：需补跑的列出计划、不需补跑的理由写清（AC2），标注提交可 `git log` 追溯（AC3）。

## Evidence

**AC1（标注数 = 父任务 AC1 清单数 = 21，机械核对）**：以父任务 AC1 同款枚举逻辑复算（main checkout `.quay/per-task-suite-records.jsonl` 现 286 条 + `isDocPath` 可计算判定）得**假跳过 21 个**，与父任务 AC1 记录的 21 个一致，全部为 `status: done`。逐个在 `tasks/<id>.md` 追加「落地未经全量轮验证」标注块（含实际改动非 doc 文件清单）。21 个被标注任务：

DIR-103-B、gap-ac65-direct-fix-vs-bypass-detector-conflict、gap-ac66-a22-checker-loose-pattern、gap-ac80-anchor-prompt-consumer-path-fix、gap-ac81-anchor-check-canonical-live-byte-mismatch、gap-ac86-dist-verify-node-floor-equivalent-path、gap-ac88-verification-mechanism-extend-deliver、gap-ac89-productization-verification-record、gap-ac90-delivery-copy-drift-gate、gap-ac92-delivery-verify-usage-intersection、gap-ac93-dist-chains-version-consistency、gap-ac97-webui-zero-cost-gaps、gap-direct-to-develop-exclude-manager-skill-granularity、gap-ff-livelock-trigger-no-action、gap-gitignored-carriers-absent-in-verify-worktree、gap-quay-init-laydown-missing-touches-checker、gap-refresh-worktree-quay-main-derive、gap-spec-reference-doc-declare-init-skill、gap-static-check-red-failures0-misattributed、gap-tick-core-drift-fast-mode-mode-conflict、gap-touches-one-entry-detector-not-enforcer。

**AC2（补跑判定，全部不需补跑）**：对每个任务取其实际 diff 非 doc 文件（读其落地 merge `M^2..F` 的真实改动，非 Touches 声明），再查落地后 develop 的全量轮覆盖：21 个任务落地后各有 **181–200 轮** `fullSuiteRan=true` 全量轮（green **180–196** 轮，最后 2026-08-21T13:12:56Z）已覆盖其改动 ⇒ **均不需补跑全量轮**。数据来源：main checkout `.quay/per-task-suite-records.jsonl`（286 条）按任务落地 merge 时刻过滤。

**AC3（git log 追溯）**：标注提交信息含「未验证」字样（提交 `27243e70`，runId `fm-gap-fan-in-delta-scope-inventory-annotate-1787312000000-inv`）⇒ 每个被标注任务的 `git log -- <file>` 均可追溯。

## Touches

- tasks/DIR-103-B.md
- tasks/gap-ac65-direct-fix-vs-bypass-detector-conflict.md
- tasks/gap-ac66-a22-checker-loose-pattern.md
- tasks/gap-ac80-anchor-prompt-consumer-path-fix.md
- tasks/gap-ac81-anchor-check-canonical-live-byte-mismatch.md
- tasks/gap-ac86-dist-verify-node-floor-equivalent-path.md
- tasks/gap-ac88-verification-mechanism-extend-deliver.md
- tasks/gap-ac89-productization-verification-record.md
- tasks/gap-ac90-delivery-copy-drift-gate.md
- tasks/gap-ac92-delivery-verify-usage-intersection.md
- tasks/gap-ac93-dist-chains-version-consistency.md
- tasks/gap-ac97-webui-zero-cost-gaps.md
- tasks/gap-direct-to-develop-exclude-manager-skill-granularity.md
- tasks/gap-ff-livelock-trigger-no-action.md
- tasks/gap-gitignored-carriers-absent-in-verify-worktree.md
- tasks/gap-quay-init-laydown-missing-touches-checker.md
- tasks/gap-refresh-worktree-quay-main-derive.md
- tasks/gap-spec-reference-doc-declare-init-skill.md
- tasks/gap-static-check-red-failures0-misattributed.md
- tasks/gap-tick-core-drift-fast-mode-mode-conflict.md
- tasks/gap-touches-one-entry-detector-not-enforcer.md（存量标注——父任务 AC1 清单 21 个假跳过任务逐个加标注）
- tasks/gap-fan-in-delta-scope-inventory-annotate.md（自身）

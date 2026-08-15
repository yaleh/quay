---
id: gap-spec-reference-doc-declare-init-skill
title: capability-catalog referenced-not-landed 红——manager/SKILL.md 引 SPEC-tick-mechanical-checks-mcp 未在 init/SKILL.md 声明 reference-doc（7e64a86b 先例同操作）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（manager 04:4xZ 定案：根因 84985e66 新增 SPEC 未查引用，第三次咬；修复面 init/SKILL.md 归 inner——7e64a86b 先例同操作）**。

**现象**：`capability-catalog.test.mjs:370` referenced-not-landed 红——`plugin/skills/manager/SKILL.md`（manager 635ec831）引用 `orchestration/SPEC-tick-mechanical-checks-mcp-2026-08-15.md`，但该 SPEC 未在 `plugin/skills/init/SKILL.md` 的 reference-doc 声明块声明。**这 red 同时阻断排除集 + carriers 两个 fan-in 的 scoped 门**。

**修复（manager 给出，一行，形态同 7e64a86b 先例）**：在 `plugin/skills/init/SKILL.md` 的 reference-doc 声明块加：
```
<!-- reference-doc: orchestration/SPEC-tick-mechanical-checks-mcp-2026-08-15.md -->
```
该文件 :130 逐字写着契约「the SPEC files the manager skill lists as an index (AC6) are each declared reference-doc below」，且已有 31 条同形声明——**不是新机制，补一条既有清单漏掉的行**。

**⛔ 不走直接提交**：init/SKILL.md 是 bypass-detector 的产品面（非排除集）⇒ 直接提交会新增 bypass 红。必须走任务 + fan-in（ff-merge 被 detector 排除）。

**⛔ 不「移除 manager/SKILL.md 引用」**：manager-layer-shipping.test.mjs AC6 断言「manager SKILL must index every on-disk orchestration/SPEC-*.md」⇒ 移除即 AC6 红（635ec831 刚修好那条）。两断言互锁：AC6 要求引用，capability-catalog 要求被引用者有声明。

**判据1**：`capability-catalog.test.mjs` 绿（referenced-not-landed 消失）。
**判据2（能取假）**：manager-layer-shipping.test.mjs AC6 仍绿（引用保留，只补声明）；排除集 + carriers fan-in 的 scoped 门不再被此 red 阻断。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**不覆盖**：不改 AC6 断言；不改 manager/SKILL.md 的引用（只补 init 声明）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 init/SKILL.md :130 reference-doc 声明块（31 条同形）+ manager/SKILL.md 的 SPEC 引用。
2. 在声明块加 `<!-- reference-doc: orchestration/SPEC-tick-mechanical-checks-mcp-2026-08-15.md -->`（1 行，同 7e64a86b 形态）。
3. 判据1：capability-catalog 绿；判据2：manager-layer-shipping AC6 仍绿。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：capability-catalog.test.mjs 绿（referenced-not-landed 消失）。
- [x] AC2 判据2 能取假：manager-layer-shipping AC6 仍绿（引用保留只补声明）；排除集/carriers scoped 门不再被此 red 阻断。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] init/SKILL.md reference-doc 补 SPEC-tick-mechanical-checks-mcp 声明（1 行）+ capability-catalog 绿 + AC6 不回归。

## Touches

- plugin/skills/init/SKILL.md（reference-doc 声明块补一行）
- tasks/gap-spec-reference-doc-declare-init-skill.md（自身）

## Evidence

（Build 落地 2026-08-15，worktree `gap-spec-reference-doc-declare-init-skill`）：
- 修复前：`capability-catalog.test.mjs:370` Wiring 测试 `referenced-not-landed` 红——manager/SKILL.md:173 引用 `orchestration/SPEC-tick-mechanical-checks-mcp-2026-08-15.md`，init/SKILL.md reference-doc 声明块无此行，quay-init.sh `verify-referenced-landed`（`grep -oE '<!-- reference-doc: … -->'` 逐字比对）判缺失。
- 修复：init/SKILL.md reference-doc 块末（`SPEC-in-flight-semantics-2026-08-14.md` 之后、`## Behavior` 之前）加 1 行 `<!-- reference-doc: orchestration/SPEC-tick-mechanical-checks-mcp-2026-08-15.md -->`（同 7e64a86b 形态，非新机制）。
- 判据1（capability-catalog）：`node --test plugin/test/capability-catalog.test.mjs` → 16/16 绿（含 :370 Wiring 测试，referenced-not-landed 消失）。
- 判据2（能取假，AC6 不回归）：`node --test plugin/test/manager-layer-shipping.test.mjs` → 7/7 绿，AC6「indexes every on-disk orchestration/SPEC-*.md」仍绿（引用保留只补声明）。
- 判据3（既有测试 + scoped 门）：`quay-init.test.mjs` + `quay-init-loop-consumer-doc-refs.test.mjs` → 9/9 绿；`quay-init-loop-driver.test.mjs` → 15/15 绿（AC7「every orchestration/* ref is landed or declared」验证新声明正确分类）；`scripts/test.sh --for-task gap-spec-reference-doc-declare-init-skill --allow-thin` → exit 0（task-contract-check / malformed-task-check / superseded-capability-check / landing-target-check 全 PASS；selector 0/2 薄选择为既有态——init/SKILL.md 无 touch→test 映射，非本次改动引入）。
- 未跑全量（Build 阶段 scoped/direct only）；排除集 + carriers 的 scoped 门不再被此红阻断。

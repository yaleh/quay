---
id: gap-spec-reference-doc-declare-init-skill
title: capability-catalog referenced-not-landed 红——manager/SKILL.md 引 SPEC-tick-mechanical-checks-mcp 未在 init/SKILL.md 声明 reference-doc（7e64a86b 先例同操作）
status: ready
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

- [ ] AC1 判据1：capability-catalog.test.mjs 绿（referenced-not-landed 消失）。
- [ ] AC2 判据2 能取假：manager-layer-shipping AC6 仍绿（引用保留只补声明）；排除集/carriers scoped 门不再被此 red 阻断。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] init/SKILL.md reference-doc 补 SPEC-tick-mechanical-checks-mcp 声明（1 行）+ capability-catalog 绿 + AC6 不回归。

## Touches

- plugin/skills/init/SKILL.md（reference-doc 声明块补一行）
- tasks/gap-spec-reference-doc-declare-init-skill.md（自身）

## Evidence

（落地后回填——capability-catalog:370 referenced-not-landed（manager/SKILL.md 引 SPEC 未声明）阻断排除集 + carriers fan-in）

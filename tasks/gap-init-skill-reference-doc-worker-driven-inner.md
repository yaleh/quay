---
id: gap-init-skill-reference-doc-worker-driven-inner
title: init/SKILL.md 补 SPEC-worker-driven-inner reference-doc 声明——referenced-not-landed 绿（manager 新 SPEC 跨面索引）
status: todo
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

**（manager 2026-08-16 03:4xZ 主动路由——造成债务的同一轮报出：新 SPEC `orchestration/SPEC-worker-driven-inner-2026-08-16.md` 触发 referenced-not-landed（quay-init.sh:1130-1145），落点 `plugin/skills/init/SKILL.md`【inner 面】。manager 已处理其面内 asserter（manager-layer-shipping AC6 补索引），引用侧路由给 inner。）**

**现象**：init/SKILL.md 已有 35+ 条 SPEC 的 `reference-doc` 声明（实测 48 条），SPEC-worker-driven-inner 这条没有 ⇒ referenced-not-landed FAIL（被 shipped skill/tick doc 引用 ∧ 目标工作区不存在 ∧ 未在 init/SKILL.md 声明）。

**修法**：init/SKILL.md 声明集加一行（检查器给的 Fix 原文）：
```
<!-- reference-doc: orchestration/SPEC-worker-driven-inner-2026-08-16.md -->
```

**⛔ 走 fan-in**：plugin/skills/init/ 是 code-surface（bypass detector 面），不得直提（cddc55e2 教训）。

**判据1**：referenced-not-landed 对该 SPEC 绿（declaration 落地）。
**判据2（能取假）**：删声明 ⇒ referenced-not-landed 红（检查器仍能抓到）；其它 SPEC 声明不受影响。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 plugin/skills/init/SKILL.md reference-doc 声明集 + quay-init.sh referenced-not-landed 判定。
2. 加一行 `<!-- reference-doc: orchestration/SPEC-worker-driven-inner-2026-08-16.md -->`（对齐现有格式）。
3. 判据2 能取假：删声明 ⇒ 红；其余声明不动。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：referenced-not-landed 对该 SPEC 绿。
- [ ] AC2 判据2 能取假：删声明 ⇒ 红；其它 SPEC 声明不受影响。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] init/SKILL.md reference-doc 声明补全（manager 新 SPEC 跨面索引闭合）。

## Touches

- plugin/skills/init/SKILL.md（reference-doc 声明加一行）
- tasks/gap-init-skill-reference-doc-worker-driven-inner.md（自身）

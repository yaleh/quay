---
id: gap-init-skill-missing-reference-doc-spec-fan-in
title: plugin/skills/init/SKILL.md 缺 reference-doc 机器声明——SPEC-fan-in-driver 被引用但无 <!-- reference-doc -->，referenced-⊆-landed 恒红
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/skills/init/SKILL.md` 对 `orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md` 只有表格提及，缺 `<!-- reference-doc: ... -->` 机器声明 ⇒ `quay-init-loop-driver` AC3/AC7 的 referenced-⊆-landed 检查报红，挡所有 landing（gap-doc-develop 的 fan-in suite 因此红、exited-not-landed）。

这是 b08494480（补 SPEC-cut-the-waiting 声明）的**漏网兄弟**（硬规则 5b：修一个应 grep 同类）。`gap-fixture-hash-omits-skill-md` 的 hash fix 落地后检查变真实，暴露了它。

## Plan

1. `plugin/skills/init/SKILL.md` 加 `<!-- reference-doc: orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md -->`。
2. 5b 全族 grep：跑 quay-init --loop referenced-⊆-landed 完整清单，确认无其它漏网声明（含 docs/analysis/*、consumer-laid 面），命中数贴提交。

## Acceptance Criteria

- [ ] AC1（能取假）：SKILL.md 含该 reference-doc 声明（grep 命中）；（⛔ 仍缺 ⇒ 假）。
- [ ] AC2（能取假，全族）：referenced-⊆-landed 完整清单零漏网（grep 全仓引用但缺声明的文件，仅剩已声明者），命中数贴提交；（⛔ 还有漏网 ⇒ 假）。

## Definition of Done

声明补齐；AC1-AC2 全勾；referenced-⊆-landed 检查转绿（quay-init-loop-driver AC3/AC7）。

## Touches

- plugin/skills/init/SKILL.md（补 reference-doc 声明）
- tasks/gap-init-skill-missing-reference-doc-spec-fan-in.md（自身）

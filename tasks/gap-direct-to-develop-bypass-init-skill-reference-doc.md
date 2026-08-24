---
id: gap-direct-to-develop-bypass-init-skill-reference-doc
title: bypass-check 豁免面缺 plugin/skills/init/——reference-doc 索引行被误判 code-surface（发生率 2）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`direct-to-develop-bypass-check.ts` 的 design-internal exclusion set（豁免 regex `:105` + predicate 字符串 `:702`）**含 `plugin/skills/manager/` 不含 `plugin/skills/init/`**，导致「给 SKILL.md 加 `<!-- reference-doc: ... -->` 索引行」这一种 docs 操作被不对称分类——manager/SKILL.md 豁免、init/SKILL.md 被误判 code-surface。**发生率 = 2**（99f845d9 一次、095af66a 一次，硬规则⑫ 过立案门槛）——不该再指望第 3 次靠人工加 ruled 条目续命。

**核实**：`plugin/skills/init/` 与 `plugin/skills/manager/` 都只含 SKILL.md（纯 docs skill 目录，无 code），同性质，应同豁免。

## Plan

豁免 regex + predicate 字符串补 `plugin/skills/init/`（与 `plugin/skills/manager/` 对齐）。目录级即可（init/ 全 docs，无需行级收窄）；若想更防御可只豁免 reference-doc 行形态（impl 落笔定）。

## Acceptance Criteria

- [ ] AC1（能取假，init/SKILL.md 豁免）：`plugin/skills/init/SKILL.md` 的 reference-doc 索引行不再判 bypass（同 manager/SKILL.md 豁免）；（⛔ 仍判 bypass ⇒ 假）。
- [ ] AC2（能取假，不扩大豁免面）：豁免只覆盖 `plugin/skills/init/`（docs skill 目录），其它 `plugin/skills/*` 或 `plugin/scripts/*` 仍判 code-surface；（⛔ 豁免扩大到非 docs ⇒ 假）。

## Definition of Done

init/SKILL.md reference-doc 索引行豁免；AC1-2 全勾；此后给 SKILL.md 加 reference-doc 声明不再需要人工加 ruled 条目。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（豁免 regex + predicate 字符串）
- plugin/test/direct-to-develop-bypass-check.test.mjs（对应测试）
- tasks/gap-direct-to-develop-bypass-init-skill-reference-doc.md（自身）
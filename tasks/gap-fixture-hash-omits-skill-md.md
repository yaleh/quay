---
id: gap-fixture-hash-omits-skill-md
title: quay-init-install-fixture _fixtureHash 漏 plugin/skills/init/SKILL.md——reference-doc 声明变更不重建 fixture，陈旧复用致 install-config-driven-e2e-upgrade 恒红
status: ready
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

`plugin/test/helpers/quay-init-install-fixture.mjs` 的 `_fixtureHash`（内容寻址）未把 `plugin/skills/init/SKILL.md`（及同类 shipped skill 声明文件）计入 hash ⇒ 基线 08-30 commit b08494480 加了 `reference-doc: orchestration/SPEC-cut-the-waiting.md` 声明后，fixture hash 不变 ⇒ 不重建 ⇒ **陈旧复用** ⇒ `install-config-driven-e2e-upgrade` 的 referenced-not-landed / bare-filename 检查恒红。

实证：基线 SKILL.md 有声明（line 155）；最新 `/var/tmp/quay-install-fixture-*`（03:59 构建）实测缺声明。同类先例 `gap-fixture-hash-omits-workflows-dirs`（fixture hash 漏 workflows 目录，同族硬规则 5b 漏网）。

## Plan

1. `_fixtureHash` 计入 `plugin/skills/init/SKILL.md`（及同类 shipped skill 声明文件），使声明变更 → hash 变 → fixture 重建。
2. 全族 grep（硬规则 5b）：枚举所有 fixture hash 漏计入的 shipped skill/声明文件，逐个确认已计入或豁免，命中数贴提交。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：`_fixtureHash` 计入 SKILL.md——grep 其计入文件列表含 `plugin/skills/init/SKILL.md`；改 SKILL.md 的 reference-doc 声明 → hash 变 → fixture 重建；（⛔ 声明变 hash 不变 ⇒ 假）。
- [ ] AC2（能取假，全族）：grep 全仓 fixture hash 漏计入的 shipped 声明文件，仅剩已计入/豁免者，命中数贴提交；（⛔ 还有漏网 ⇒ 假）。

## Definition of Done

_fixtureHash 计入 SKILL.md；AC1-AC2 全勾；一次声明变更验证 hash 变 + fixture 重建；全量 suite 绿（referenced-not-landed 不再恒红）。

## Touches

- plugin/test/helpers/quay-init-install-fixture.mjs（_fixtureHash 计入 SKILL.md）
- tasks/gap-fixture-hash-omits-skill-md.md（自身）

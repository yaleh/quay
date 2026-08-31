---
id: gap-fixture-hash-omits-shipped-files
title: _fixtureHash 计入所有 shipped 文件类（完整化 sweep）——vendored/workflows/skills 声明逐类验证 hash 覆盖，防第 4/5 缺口
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

`quay-init-install-fixture.mjs` 的 `_fixtureHash` 逐类漏计入 shipped 文件，已三例：workflows 目录（gap-fixture-hash-omits-workflows-dirs，done）、skills/*/SKILL.md 声明（gap-fixture-hash-omits-skill-md，done）、vendored bundle `plugin/vendor/quay-native/dist/quay-native.js`（gap-fixture-hash-omits-vendored-bundle，本族第三例）。每例都是「某类 shipped 文件变更不重建 fixture → 陈旧复用 → 恒红」。本任务做**完整化 sweep**：枚举所有被 quay-init --loop 读取/影响的 shipped 文件类（vendored bundle、workflows 目录、skills/*/SKILL.md、及任何其它 shipped/derived 类），逐类验证 hash 覆盖——避免第 4、5 个缺口（硬规则 5b 的根治形态）。

## Plan

1. 枚举所有 shipped 文件类（vendored / workflows / skills / derived）。
2. `_fixtureHash` 逐类计入；每类负控制：touch 该类任一文件 → hash 必变 → 重建；不 touch → hash 不变。

## Acceptance Criteria

- [ ] AC1（能取假，逐类负控制）：对每类 shipped 文件，「touch 该类任一文件 → fixture hash 必变 → 重建；不 touch → hash 不变」（一命令可验）；（⛔ 某类 touch 后 hash 不变 ⇒ 假）。
- [ ] AC2（能取假，全类覆盖）：grep 全仓 shipped 文件类（vendored/workflows/skills/derived），每类都在 `_fixtureHash` 计入列表内，无漏网，命中数贴提交；（⛔ 还有漏网 ⇒ 假）。
- [ ] AC3（能取假）：真实一轮全量 suite 绿。

## Definition of Done

全类 shipped 文件覆盖；AC1-AC3 全勾；逐类负控制读数；真实一轮 suite 绿。

## Touches

- plugin/test/helpers/quay-init-install-fixture.mjs（_fixtureHash 全类 shipped 文件）
- tasks/gap-fixture-hash-omits-shipped-files.md（自身）

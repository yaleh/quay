---
id: gap-fixture-hash-omits-vendored-bundle
title: quay-init-install-fixture _fixtureHash 漏 plugin/vendor/quay-native/dist/quay-native.js——vendored bundle 变更不重建 fixture，runtime 陈旧致 stale-runtime 恒红
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

`plugin/vendor/quay-native/dist/quay-native.js`（vendored bundle）未在 `quay-init-install-fixture.mjs` 的 `_fixtureHash` 计算内（grep helper 无 vendor/quay-native）→ bundle 历史某刻变更后 fixture 不重建 → 测试工作区 runtime 陈旧 → `quay-init-loop-runtime` AC10 报 `stale-runtime`（/tmp/laydown-* 与当前 bundle 不一致）→ 挡所有 landing。

这是 fixture hash 漏计入族的**第三例**（同族 gap-fixture-hash-omits-workflows-dirs done、gap-fixture-hash-omits-skill-md ready）——硬规则 5b：修一个应 grep 同类。前两例都是「声明/目录」类，本例是「vendored 产物」类，属不同文件类别。

## Plan

1. `_fixtureHash` 计入 `plugin/vendor/quay-native/dist/quay-native.js`（及同类 vendored 产物），使 bundle 变更 → hash 变 → fixture 重建。
2. 5b 全族 grep：枚举所有 fixture hash 漏计入的 vendored 产物（`plugin/vendor/` 下），逐个确认已计入或豁免，命中数贴提交。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：`_fixtureHash` 计入 vendored bundle——grep 其计入文件列表含 `plugin/vendor/quay-native/dist/quay-native.js`；改 bundle → hash 变 → fixture 重建；（⛔ bundle 变 hash 不变 ⇒ 假）。
- [ ] AC2（能取假，全族）：grep `plugin/vendor/` 下 vendored 产物，仅剩已计入/豁免者，命中数贴提交；（⛔ 还有漏网 ⇒ 假）。

## Definition of Done

_fixtureHash 计入 vendored bundle；AC1-AC2 全勾；一次 bundle 变更验证 hash 变 + fixture 重建；全量 suite 绿（stale-runtime 不再恒红）。

## Touches

- plugin/test/helpers/quay-init-install-fixture.mjs（_fixtureHash 计入 vendored bundle）
- tasks/gap-fixture-hash-omits-vendored-bundle.md（自身）

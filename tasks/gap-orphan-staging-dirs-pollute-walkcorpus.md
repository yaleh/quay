---
id: gap-orphan-staging-dirs-pollute-walkcorpus
title: 孤儿 plugin-staging-* 目录污染 walkCorpus 扫描（staging 测试被 kill 残留，致 loop-shipping.test.mjs 假红）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`packages/quay/plugin-staging-<ts>-{0,1}/` 是 npm-pack/staging 测试的构建产物目录。staging 测试被 kill（OOM/中断）时不清理 ⇒ 孤儿目录残留，污染 `walkCorpus`（或其它目录扫描）的扫描结果。实证 2026-08-25：worktree 里 05:15 被 kill 的测试残留 `packages/quay/plugin-staging-3477285-{0,1}/`，致 loop-shipping.test.mjs 红（worker 手动删除才恢复）。

## Plan

两条修法（或组合）：① `walkCorpus`/`exclusionTargets` 排除 `plugin-staging-*` 模式；② staging 测试启动时清既往 orphan（`plugin-staging-*` 残留）。实现时核哪条更稳（① 更防御、② 更彻底）。

## Acceptance Criteria

- [ ] AC1（能取假，不污染）：一个 `plugin-staging-*` 孤儿目录存在时，`walkCorpus`（或 loop-shipping 扫描）不再把它当输入（排除生效）；（⛔ 仍污染 ⇒ 假）。
- [ ] AC2（能取假，负控制）：删掉排除/清理逻辑，loop-shipping.test.mjs 对孤儿 staging 目录须红；（⛔ 删了不红 ⇒ 假）。
- [ ] AC3（能取假，清理或排除落地）：staging 测试启动清孤儿，或 walkCorpus 排除 pattern 落地（grep 到其一）；（⛔ 两者皆无 ⇒ 假）。

## Definition of Done

孤儿 staging 目录不再污染扫描；AC1/AC2/AC3 全勾；loop-shipping.test.mjs 对孤儿 staging 目录的负控制绿。

## Touches

- packages/quay/（walkCorpus/exclusionTargets 排除 plugin-staging-*，或 staging 测试清理）
- plugin/scripts/ 或 packages/quay/src/（扫描逻辑所在处）
- packages/quay/test/（staging 清理/排除测试 + 负控制）
- tasks/gap-orphan-staging-dirs-pollute-walkcorpus.md（自身）

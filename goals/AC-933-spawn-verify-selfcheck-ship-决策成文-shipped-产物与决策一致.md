---
id: AC-933
title: spawn-verify/selfcheck ship 决策成文 + shipped 产物与决策一致
status: draft
kind: criterion
goal: GOAL-913
criterion: node --test plugin/test/codex-ship-surface-consistency.test.mjs
expect: 正向：决策记录存在（ship 或 dev-tree-only），且 shipped artifact 的 codex 面与决策一致（ship 则
  reachable，dev-tree-only 则无用户面宣传）；反向：产物与决策矛盾时测试红
origin: 人 2026-10-30 裁定：spawn-verify 是否 ship 写进 goal，落地为成文决策 + 一致性判据
phase: pre-merge
---

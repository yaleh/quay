---
id: AC-167
title: baime-iteration-executor.md 从 plugin.json 摘除并 archive
status: achieved
kind: criterion
goal: GOAL-003
criterion: |-
  grep -q 'baime-iteration-executor' plugin/.claude-plugin/plugin.json && exit 1
  [ -e plugin/agents/baime-iteration-executor.md ] && exit 1
  [ -e plugin/scripts/workflows-dual-copy-drift-check.ts ] && exit 1
  grep -q 'baime-iteration-executor' archive/INDEX.tsv || exit 1
  exit 0
expect: exit 0（plugin/.claude-plugin/plugin.json 不再提及 baime-iteration-executor ∧
  该 agent 与 workflows-dual-copy-drift-check.ts 均已移走 ∧ archive/INDEX.tsv 有其归档记录）
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役（archive），后续发现需要了再恢复」。正本
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md。
---

**判据（能取假）**：`plugin/agents/baime-iteration-executor.md` 从 `plugin.json` 摘除并 archive；
`workflows-dual-copy-drift-check.ts` 随双副本消失一并 archive（失去判定对象）。



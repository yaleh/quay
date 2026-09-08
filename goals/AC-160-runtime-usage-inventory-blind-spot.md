---
id: AC-160
title: 修 runtime-usage-inventory.ts 的枚举盲区
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  grep -vE '^[[:space:]]*(//|\*)' plugin/scripts/runtime-usage-inventory.ts |
  grep -q 'subagents/workflows' || exit 1

  node --experimental-strip-types --test
  plugin/test/runtime-usage-inventory-workflows-enumeration.test.mjs >/dev/null
  2>&1
expect: exit 0（runtime-usage-inventory.ts 在非注释位置枚举 subagents/workflows ∧ 回归测试
  runtime-usage-inventory-workflows-enumeration.test.mjs 通过——该测试须在未修版本上必红）
origin: >
  人 2026-09-02 裁定④「对零调用的工具，先退役」。正本
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md

  §11b-i（「乙、把仪器修对——否则下一次普查还是错的」）。
---

**判据（双向）**：修 `runtime-usage-inventory.ts` 的枚举盲区——`readTranscripts` 须枚举
`<session>/subagents/workflows/<run>/agent-*.jsonl`。修复后对 `monitor-mount-check.sh` 报
`executed > 0`（**当前报 0**），且新增一个 fixture 测试**在未修版本上必红**。

**取假**：不改 ⇒ 仍报 0；只加测试不改实现 ⇒ 测试红。



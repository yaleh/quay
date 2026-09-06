---
id: AC-160
title: 修 runtime-usage-inventory.ts 的枚举盲区
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役」。正本 SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
  §11b-i（「乙、把仪器修对——否则下一次普查还是错的」）。
---

**判据（双向）**：修 `runtime-usage-inventory.ts` 的枚举盲区——`readTranscripts` 须枚举
`<session>/subagents/workflows/<run>/agent-*.jsonl`。修复后对 `monitor-mount-check.sh` 报
`executed > 0`（**当前报 0**），且新增一个 fixture 测试**在未修版本上必红**。

**取假**：不改 ⇒ 仍报 0；只加测试不改实现 ⇒ 测试红。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。

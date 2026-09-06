---
id: AC-157
title: archive 机制落地 + 五个排除面接线（AC158 的前置）
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定④「对零调用的工具，先退役（archive），后续发现需要了再恢复」。
  正本 orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §12a。
---

**判据（能取假）**：archive 机制落地——`archive/<日期>-<slug>/<保持原始相对路径>` + `archive/INDEX.tsv`
（SPEC §12a 的七字段）+ **五个排除面接线**（`capability-catalog.sh` / `runtime-usage-inventory.ts` /
`scripts/test.sh` 测试 glob / laydown 交付面闭包 / `version-consistency-check.ts`）。

**取假**：随便 archive 一个文件后跑全量 suite——**不接线必红**；接线后应绿。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。

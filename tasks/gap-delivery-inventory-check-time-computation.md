---
id: gap-delivery-inventory-check-time-computation
title: delivery inventory 改 check 时现算，消除 outline snapshot 冲突热点
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`docs/proposals/quay-product-outline.md` 的 §6 DELIVERY-INVENTORY 是一个**提交的、手同步的计数**（`scripts=294 · gate-scripts=14 · ...`）。`delivery-inventory-drift-gate.sh` 强制「每个增删 plugin/scripts 的任务都要在同一 change 里同步改这个 snapshot」，于是 outline 的 `scripts=N` 成了**所有 script 任务的公共串行点**。实证：2026-08-29 批量重派 21 个任务时，4 个 merge 冲突里 **3 个在 outline**（gap-b0 / gap-b1 / gap-writestate，均因退休改的 296→294 与任务自己的改动相撞）。

这个计数本**机械派生**（`verify-delivery-surface.ts --inventory` 数 `plugin/scripts/` 目录），不该由每个任务手改一份提交快照。根治：把 inventory 从「提交 snapshot」改成「check 时现算」。

## Plan

1. `delivery-inventory-drift-gate.sh`：语义从「change set 是否同步改了 outline snapshot」改为「**check 时经 `verify-delivery-surface.ts --inventory` 现算 inventory 并比对**」（或退役该 gate——若现算已使其 drift 检查失去对象）。
2. `docs/proposals/quay-product-outline.md` §6：移除手编辑的计数（`scripts=N` 等），改为**生成视图/指针**——交付面摘要由 `verify-delivery-surface.ts --inventory` 现算承载，不再由提交快照承载。
3. 读者 `verify-deliver-coldstart.sh` / `release-freshness-check.sh`：改读现算 inventory，不再读提交快照。
4. `select-static-checks-for-touches.ts` / `capability-catalog.sh`：同步 gate 语义变更或退役标注。

## Acceptance Criteria

- [ ] AC1（能取假，快照移除）：`docs/proposals/quay-product-outline.md` §6 不再含手编辑的 `scripts=N` 计数（grep 不到 `scripts=`，或标注为「由 verify-delivery-surface --inventory 现算」生成视图）。
- [ ] AC2（能取假，现算替代）：`delivery-inventory-drift-gate.sh`（或替代机件）经 `verify-delivery-surface.ts --inventory` 现算 inventory，不再依赖提交快照（grep 其源码含 `--inventory` 调用或已退役标注）。
- [ ] AC3（能取假，冲突热点消除）：两个各自增删 plugin/scripts 的任务，其 worktree fork 于不同 develop 基点时，`merge develop` 不再因 outline 的 `scripts=N` 冲突（outline 已非手编辑值）。
- [ ] AC4（能取假，摘要仍可读）：交付面摘要仍可经 `verify-delivery-surface.ts --inventory` 现算得到（release/人工审计时一条命令可查），不因移除快照而丢失。

## Definition of Done

outline 的 §6 计数不再是手编辑的提交快照，而是由 `verify-delivery-surface.ts --inventory` 现算承载；delivery-inventory-drift-gate 语义随之改为现算比对（或退役）；读者改读现算结果；两个增删 script 的任务合并时不再撞 outline 计数冲突。落地即消除「outline snapshot 是共享冲突热点」这一整类 merge 冲突。

## Touches

- plugin/scripts/delivery-inventory-drift-gate.sh（现算/退役）
- plugin/scripts/verify-delivery-surface.ts（--inventory 现算承载）
- docs/proposals/quay-product-outline.md（§6 移除手编辑计数）
- plugin/scripts/verify-deliver-coldstart.sh（改读现算）
- plugin/scripts/release-freshness-check.sh（改读现算）
- plugin/scripts/select-static-checks-for-touches.ts（gate 语义/退役）
- plugin/scripts/capability-catalog.sh（gate 标注）
- tasks/gap-delivery-inventory-check-time-computation.md（自身）

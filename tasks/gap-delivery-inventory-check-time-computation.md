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

- [x] AC1（能取假，快照移除）：`docs/proposals/quay-product-outline.md` §6 不再含手编辑的 `scripts=N` 计数（grep 不到 `scripts=`，或标注为「由 verify-delivery-surface --inventory 现算」生成视图）。
  - 实证：`<!-- DELIVERY-INVENTORY-BEGIN -->` / `scripts=294 · gate-scripts=14 · …` / `<!-- DELIVERY-INVENTORY-END -->` 块已删（`git show 48b41eb13`）；`grep -nE 'scripts=[0-9]+' docs/proposals/quay-product-outline.md` 归零（exit 1）——残留仅 §6 prose `scripts=N`（字面占位符缘由）一处，无数值 token。测试 `verify-delivery-surface.test.mjs` `assert.doesNotMatch(outline, /scripts=\d+/)` 绿。
- [x] AC2（能取假，现算替代）：`delivery-inventory-drift-gate.sh`（或替代机件）经 `verify-delivery-surface.ts --inventory` 现算 inventory，不再依赖提交快照（grep 其源码含 `--inventory` 调用或已退役标注）。
  - 实证：`delivery-inventory-drift-gate.sh` 头部带「RETIRED TRIGGER (gap-delivery-inventory-check-time-computation, 2026-08-29)」退役标注；outline-snapshot 触发已删，保留独立的 workflow 镜像触发；inventory 改由 `verify-delivery-surface.ts --inventory` check 时现算（exit 0 报告，无快照）。
- [x] AC3（能取假，冲突热点消除）：两个各自增删 plugin/scripts 的任务，其 worktree fork 于不同 develop 基点时，`merge develop` 不再因 outline 的 `scripts=N` 冲突（outline 已非手编辑值）。
  - 实证：outline 无数值 `scripts=N` token（AC1 归零）⇒ 两个 fork 于不同 develop 基点、各自增删 plugin/scripts 的任务不再共编同一条共享快照行；drift gate 不再要求 outline co-touch（`runner-static-gate.ts` `@static-object` 由 `plugin/scripts/ docs/proposals/quay-product-outline.md` 改为 `.claude/workflows/ plugin/workflows/`）。
- [x] AC4（能取假，摘要仍可读）：交付面摘要仍可经 `verify-delivery-surface.ts --inventory` 现算得到（release/人工审计时一条命令可查），不因移除快照而丢失。
  - 实证：`node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory` → exit 0，报 `scripts=294 · gate-scripts=14 · skills=13 · probes=5 · loop=6 · workflows=5 · agents=1 · vendor=2`（8 目录磁盘真值）；直接测试全绿（verify-delivery-surface 22/22、drift-gate 8/8、select-static-checks 17/17）。

## Definition of Done

outline 的 §6 计数不再是手编辑的提交快照，而是由 `verify-delivery-surface.ts --inventory` 现算承载；delivery-inventory-drift-gate 语义随之改为现算比对（或退役）；读者改读现算结果；两个增删 script 的任务合并时不再撞 outline 计数冲突。落地即消除「outline snapshot 是共享冲突热点」这一整类 merge 冲突。

## Touches

- plugin/scripts/verify-delivery-surface.ts（--inventory 现算承载）
- plugin/scripts/delivery-inventory-drift-gate.sh（outline 触发退役，保留 workflow 镜像触发）
- plugin/scripts/runner-static-gate.ts（gate @static-object/注释同步）
- plugin/scripts/select-static-checks-for-touches.ts（移除 DELIVERY_INVENTORY_CHECKER + 注册表去 outline）
- plugin/scripts/capability-catalog.sh（gate 六表标注）
- plugin/scripts/checker-mutation-cases/delivery-inventory-drift-gate.sh（移除 script 阶段）
- docs/proposals/quay-product-outline.md（§6 移除手编辑计数）
- plugin/test/verify-delivery-surface.test.mjs（inventory 测试重写）
- plugin/test/delivery-inventory-drift-gate.test.mjs（移除 outline 测试）
- plugin/test/select-static-checks-for-touches.test.mjs（注册表断言更新）
- tasks/gap-delivery-inventory-check-time-computation.md（自身）

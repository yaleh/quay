---
id: gap-ac123-suite-bucket-cross-bucket-both-sides
title: AC123 跨桶测试计入两边（P-only 与 M-only 两个方向都要选中那 12 个）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac120-suite-bucket-attribution-mechanism
---

**type:** execution

## Proposal

**来源**：`orchestration/manager-phase-goal.md` 当前阶段 AC123。

**判据**：跨桶测试（基线实测 40 个 / 9.0%）在其**每一个**所属桶被触发时都必须入选，⛔ 不得只归一边。

**取假**：构造一个只碰 P 的变更，那 12 个 `packages/*/test` 中碰 `plugin/scripts` 的测试必须在选中集里；再构造一个只碰 M 的变更，同样 12 个也必须在选中集里。任一方向缺失 ⇒ 本 AC 未达成。

**为什么 inner 执行**：跨桶入选逻辑是分桶执行机制的一部分（`plugin/scripts/` 或 `scripts/test.sh` 接线）→ inner 域。

## Plan

1. 分桶执行接线：跨桶测试在其每一个所属桶被触发时都入选（安全侧不做减法）。
2. 构造 P-only 变更 → 那 12 个 `packages/*/test` 碰 `plugin/scripts` 的测试必须在选中集。
3. 构造 M-only 变更 → 同样 12 个也必须在选中集。
4. fan-in land。

## Acceptance Criteria

- [ ] AC1: 跨桶测试在其每一个所属桶被触发时都入选（不单边）。
- [ ] AC2: P-only 变更回放 → 12 个跨桶测试在选中集；M-only 变更回放 → 同样 12 个也在选中集。

## Definition of Done

- [ ] 跨桶两边入选接线完成，两个方向回放绿；land 到 develop；AC1-2 全勾。

## Touches

- tasks/gap-ac123-suite-bucket-cross-bucket-both-sides.md（自身）

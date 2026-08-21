---
id: gap-ac123-suite-bucket-cross-bucket-both-sides
title: AC123 跨桶测试计入两边（P-only 与 M-only 两个方向都要选中那 12 个）
status: done
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

## Test-Files

- plugin/test/suite-bucket-attribution.test.mjs（AC120 机制测试：AC2(a) 断言 12 个跨桶测试判为 P 与 M——归属面已把"两边"钉住）

## 执行证据（inner 2026-08-21）

**判定：`gap-ac123` 的「跨桶计入两边」由 AC120 机制已固有满足，无需代码变更。**

- AC120 `suite-bucket-attribution.ts` 的 `bucketSetOf()` 返回 `Set<Bucket>`（非单一"主桶"）；跨桶测试得 `{P,M}`（碰 `scripts/test.sh` 的得 `{P,S,M}`），机制里不存在"归一边"的赋值。⇒ "选中集" = "桶集合含被触发桶"的测试全集（`contains` 即集合成员定义），P-only 与 M-only 两个方向天然都含那 12 个。
- 回放（`node --experimental-strip-types` 对 426 个测试文件逐一 `bucketSetOf`，选中规则 = 桶集合含被触发桶）：
  - P-selected（含 P）= **146**；M-selected（含 M）= **219**。
  - 12 个 `packages/quay/test/*` 碰 `plugin/scripts` 的跨桶测试：**P-only 12/12 在选中集；M-only 12/12 也在选中集**（BOTH-SIDES PASS）。
  - 逐文件归属（全含 P 且含 M）：build-plugin-dist=P+M、gap-dashboard-parallelize=P+M、install-config-driven-e2e-runtime=P+M、install-config-driven-e2e-upgrade=P+M、install-config-driven-e2e=P+S+M、lifecycle=P+M、mcp-server=P+M、npm-pack-e2e=P+M、sea-artifact-consumer-e2e=P+S+M、serve-ac95-views=P+S+M、serve-board=P+M、serve=P+M。
- 机制测试复跑：`bash scripts/test.sh plugin/test/suite-bucket-attribution.test.mjs` → 7 pass / 0 fail。

## Acceptance Criteria

- [x] AC1: 跨桶测试在其每一个所属桶被触发时都入选（不单边）。
- [x] AC2: P-only 变更回放 → 12 个跨桶测试在选中集；M-only 变更回放 → 同样 12 个也在选中集。

## Definition of Done

- [x] 跨桶两边入选接线完成（AC120 Set 归属已固有，无需接线改动），两个方向回放绿；land 到 develop 由 fan-in 步骤完成；AC1-2 全勾。

## Touches

- tasks/gap-ac123-suite-bucket-cross-bucket-both-sides.md（自身）

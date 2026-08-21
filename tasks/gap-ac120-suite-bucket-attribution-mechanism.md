---
id: gap-ac120-suite-bucket-attribution-mechanism
title: AC120 suite 桶归属判据机械化（静态引用闭包 → P|S|M|UNRESOLVED，三组样本回放能取假）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：`orchestration/manager-phase-goal.md` 当前阶段「按变更选择性执行 —— suite 三桶划分」AC120（人 2026-08-21 16:4xZ 裁定链③「比 scoped 门更大颗粒度、用于替代 suite 的机制」的机制第一步）。

**判据**：产出机件，输入 = 一个测试文件路径，输出 = `P | S | M | UNRESOLVED` 之一。判据是**静态引用闭包**——import 相对路径规范化 + `plugin/scripts` / `packages/*/(src|bin|dist)` / `scripts/test.sh` 路径字面量。⛔ 不得用 basename 配对、⛔ 不得用目录归属当唯一依据（`plugin/` 整树随 npm 交付，目录 ≠ 桶）。

**取假（三组已知样本回放，任一组不符 ⇒ 本 AC 未达成）**：
(a) `packages/quay/test/*` 中碰 `plugin/scripts` 的 12 个 → 必须判为跨桶（P 与 M）；
(b) `plugin/test/*` 中碰 packages 源码的 23 个 → 同理跨桶；
(c) 静态不可定位的 11 个 → 必须输出 `UNRESOLVED`（⛔ 不得默认归任一桶——硬规则 3b：读不懂 ≠ 合格）。

**与既有机制分工（⛔ 不得混淆，粒度不同）**：`select-tests-for-touches.ts`（`scripts/test.sh:1967/2017` 的 `--for-task`）= 文件级 scoped 门，basename 配对，**已接线，本阶段不动它**；本 AC 是**桶级**。

**为什么 inner 执行**：实现机件 + 测试属产品代码（`plugin/scripts/` + `plugin/test/`）→ inner 域。

## Plan

1. 实现 `plugin/scripts/suite-bucket-attribution.ts`（名可 inner 定）：静态解析 import 相对路径 + 路径字面量，规范化后按三桶引用闭包归类，输出 P|S|M|UNRESOLVED。
2. 写测试 `plugin/test/suite-bucket-attribution.test.mjs`：含三组已知样本（12 / 23 / 11）回放。
3. 跑 scoped + 全量确认绿；fan-in land（AC78 workflow）。

## Acceptance Criteria

- [ ] AC1: 机件存在，对任意测试文件路径输出 P|S|M|UNRESOLVED 之一（静态引用闭包，非 basename 配对、非目录唯一依据）。
- [ ] AC2: 三组已知样本回放全符合——(a) 12 个 `packages/quay/test` 碰 `plugin/scripts` 判为跨桶；(b) 23 个 `plugin/test` 碰 packages 源码判为跨桶；(c) 11 个不可定位判为 UNRESOLVED。

## Definition of Done

- [ ] 分桶归属机件实现完成、三组已知样本回放测试全绿、AC1-2 全勾；fan-in land 到 develop。

## Touches

- plugin/scripts/suite-bucket-attribution.ts (new)
- plugin/test/suite-bucket-attribution.test.mjs (new)
- tasks/gap-ac120-suite-bucket-attribution-mechanism.md（自身）

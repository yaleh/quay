---
id: gap-ac104-version-bump-v060
title: AC104 版本号推进到 v0.6.0（8 处一致）——当前阶段管线第一步
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：当前阶段（2026-08-20 07:3xZ 切换）AC104——「基于当前版本的 build / 跨主机验证 / 发布 v0.6.0」的第一步。人裁定阶段切换；AC104-109 落笔归属 outer（立案/驱动）+ inner（产品代码）。

**判据**（能取假，一条命令）：`node --experimental-strip-types scripts/version-consistency-check.ts` 输出 `All 8 files carry version 0.6.0`。取假：任一文件残留 0.5.0 或版本不齐 ⇒ 脚本非零退出并列出不一致项。**⛔ 不得手工逐个改 8 处而不跑该检查器**。

**8 处**（当前全 0.5.0）：
- packages/quay、packages/quay-native、packages/quay-github、packages/quay-backlog
- plugin/.claude-plugin/plugin.json、plugin/.claude-plugin/marketplace.json（quay entry）
- .claude-plugin/marketplace.json（quay entry）、plugin/vendor/quay/package.json

**为什么 inner 执行**：版本字段属产品代码（package.json 等），D 段边界 outer 不改产品代码 → inner 域。

**为什么现在**：新批（waitExit-race + turn-budget）已全 land（46b76046），0 在飞，load 低。AC104 是 AC105（build tgz）→ AC107（跨主机）→ AC118/119（已 ready 等管线）的前置。human 裁定「AC104 等 outer 自然轮到」——现在到了。

## Plan

1. 改 8 处版本字段 0.5.0 → 0.6.0。
2. 跑 `node --experimental-strip-types scripts/version-consistency-check.ts` 确认输出 `All 8 files carry version 0.6.0`。
3. 提交（含版本 bump 说明）。

## Acceptance Criteria

- [ ] AC1: `scripts/version-consistency-check.ts` 输出 `All 8 files carry version 0.6.0`（不是手动逐个改而不跑检查器）。
- [ ] AC2: 8 处版本字段全为 0.6.0，无残留 0.5.0（脚本零退出）。

## Definition of Done

- [ ] version-consistency-check 绿（输出 All 8 files carry version 0.6.0）；提交可 `git log` 追溯。

## Touches

- packages/quay/package.json（版本）
- packages/quay-native/package.json（版本）
- packages/quay-github/package.json（版本）
- packages/quay-backlog/package.json（版本）
- plugin/.claude-plugin/plugin.json（版本）
- plugin/.claude-plugin/marketplace.json（版本）
- .claude-plugin/marketplace.json（版本）
- plugin/vendor/quay/package.json（版本）
- tasks/gap-ac104-version-bump-v060.md（自身）

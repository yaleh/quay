---
id: gap-direct-to-develop-ruled-historical-99f845d9
title: detector 加 ruled-historical 豁免承载 99f845d9——outer 解全库红的止损直提，manager 裁定 ruled one-off
status: done
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

**（outer 2026-08-23 立案——manager 对 99f845d9 红的裁定：ruled one-off，形态=ruled 豁免+定案理由，非 AC65 sha 表）**

**背景（实测，非推断）**：`99f845d9`（outer 直提 develop 补 `plugin/skills/init/SKILL.md` 一行 `<!-- reference-doc: -->` 声明）被 detector 标 `confirmedBypass`。它是为解「referenced-not-landed」全库红而做的最小止损（补一行声明），非偷懒绕过 fan-in。但**直提 develop 本身就是错的**（应走 fan-in）——本次是我方共同的流程失误。该红现阻断 fan-in 静态门，已致 8 条任务 exited-not-landed、自 14:09 起零落地。

**manager 定案理由（⛔ 原话入表）**：性质同 f9577da1/167b7052 那一类（为修机制自身而直写，非偷懒绕过 fan-in），且该类写在本轮之后不应再发生。

**机制**：复用 `RULED_HISTORICAL_COMMITS` 表（已有，先例 cddc55e2），加一条 `{sha: "99f845d9", reason}`。⛔ 不改 sha 退役表 / AC65 两谓词机制；判据3（声明∧无验证⇒红）不松动。

**⛔ 自指死锁（8dfd2967 先例）**：ruling-add 提交本身也是直接提交 ⇒ **必须走 fan-in**（worktree → 改 checker → suite → ff-merge，ff-lock 时间窗豁免本任务 merge 提交），⛔ 不得直提 develop（那会造第五条红）。

## Plan

1. 读 `direct-to-develop-bypass-check.ts` 的 `RULED_HISTORICAL_COMMITS` 表。
2. 加一条 `{sha: "99f845d9", reason: <manager 定案理由>}`。
3. 判据能取假：99f845d9 → ruledHistorical；真直投仍红。
4. 既有测试全绿 + 走 fan-in ff-merge land。

## Acceptance Criteria

- [x] AC1：99f845d9 分类为 ruledHistorical（非 bypass、非 ac65Authorized，输出可区分）。
- [x] AC2（能取假）：真直投（无豁免）仍红；99f845d9 不再红；判据3（声明∧无验证⇒红）不变。
- [x] AC3：既有测试全绿 + 经 fan-in ff-merge land（⛔ 非直提 develop）。

## Definition of Done

- [ ] 99f845d9 入 ruled 表 + 定案理由，ruledHistorical 分类可区分，判据3 不松动，测试绿，fan-in land。

## Retires

- 无

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（RULED_HISTORICAL_COMMITS 加 99f845d9 条目）
- plugin/test/direct-to-develop-bypass-check.test.mjs（test）
- tasks/gap-direct-to-develop-ruled-historical-99f845d9.md（自身）

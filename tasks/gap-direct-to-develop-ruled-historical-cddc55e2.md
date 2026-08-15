---
id: gap-direct-to-develop-ruled-historical-cddc55e2
title: detector 加 ruled-historical 豁免承载 cddc55e2——manager 裁定 one-off 形态=ruled 豁免+定案理由（非 AC65 sha 表；判据3 不松动）
status: todo
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

**（inner 2026-08-15 16:0xZ 立案——manager 对 cddc55e2 红的裁定：① one-off 通过但形态改）**。

**背景**：cddc55e2（inner 直接提交 plugin/skills/init/SKILL.md，code-surface 无 AC65）被 detector 标 confirmedBypass。其内容已冗余（正规渠道 re-land），但提交在 develop 历史中。manager 裁定：③ rebase 否（抹教训+高风险）、② 基线推进否（误豁免 20 个直提交）、**① one-off ✅ 但形态 = ruled 豁免 + 定案理由**，先例 = fan-in-workflow-check 的 `RULED_HISTORICAL_GAPS`（86a7c932）。

**定案理由**：cddc55e2 不是「偷懒绕过 fan-in」（detector 要抓的），是「紧急回退自己刚造成的破坏」——它回退的 232e4171 是 inner 在双副本漂移上的试错。豁免理由：「它不属于 detector 要抓的那一类」。

**⛔ 约束**：判据3（声明∧无验证⇒红）不因此松动；cddc55e2 走「ruled-historical」类，非「AC65-authorized」类——**两类在 detector 输出里必须是可区分的取值**。

**机制（供 inner 选，同 fan-in-workflow-check RULED_HISTORICAL_GAPS 先例）**：detector 加 ruled 豁免表（`RULED_HISTORICAL_COMMITS`，{sha, reason}），入表提交分类为 `ruledHistorical`（可见+可审计，非静默掩盖）；非入表新直投仍红（能取假，豁免表有界不随新提交增长）。⛔ 不改 sha 退役表机制（AC65 两谓词保持）；判据3 保持。

**判据1**：cddc55e2 分类为 `ruledHistorical`（非 bypass、非 ac65Authorized，输出可区分）。
**判据2（能取假）**：真直投（无 AC65、无 ruled 豁免）仍红；cddc55e2 不再红；判据3（声明∧无验证⇒红）不变。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 direct-to-develop-bypass-check.ts（classifyCommit / ac65Authorized）+ fan-in-workflow-check.ts RULED_HISTORICAL_GAPS 先例。
2. detector 加 ruled 豁免表（RULED_HISTORICAL_COMMITS，cddc55e2 + 定案理由），classifyCommit 增加 ruledHistorical 分类。
3. 判据2 能取假：cddc55e2 → ruledHistorical；真直投仍红；判据3 不变。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：cddc55e2 分类为 ruledHistorical（非 bypass、非 ac65Authorized，输出可区分）。
- [ ] AC2 判据2 能取假：真直投（无豁免）仍红；cddc55e2 不再红；判据3（声明∧无验证⇒红）不变。
- [ ] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] detector ruled 豁免表（cddc55e2 + 定案理由）落地，ruledHistorical 分类可区分，判据3 不松动，测试绿——detector 红消除。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（ruled 豁免表 + ruledHistorical 分类）
- plugin/test/direct-to-develop-bypass-check.test.mjs（对应测试）
- tasks/gap-direct-to-develop-ruled-historical-cddc55e2.md（自身）

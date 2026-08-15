---
id: gap-direct-to-develop-ruled-historical-cddc55e2
title: detector 加 ruled-historical 豁免承载 cddc55e2——manager 裁定 one-off 形态=ruled 豁免+定案理由（非 AC65 sha 表；判据3 不松动）
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

- [x] AC1 判据1：cddc55e2 分类为 ruledHistorical（非 bypass、非 ac65Authorized，输出可区分）。
- [x] AC2 判据2 能取假：真直投（无豁免）仍红；cddc55e2 不再红；判据3（声明∧无验证⇒红）不变。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] detector ruled 豁免表（cddc55e2 + 定案理由）落地，ruledHistorical 分类可区分，判据3 不松动，测试绿——detector 红消除。

## Evidence

**实现**：`plugin/scripts/direct-to-develop-bypass-check.ts` 加 `RULED_HISTORICAL_COMMITS`（`{sha, reason}`，承载 cddc55e2 + manager 定案理由，先例 fan-in-workflow-check `RULED_HISTORICAL_GAPS`）+ `findRuledHistoricalEntry`（前缀匹配，同 AC65 表）。`classifyCommit` 增加 `ruledHistorical`/`ruledReason` 分类（独立分类，非 bypass、非 ac65Authorized），`bypass = !designInternal && !inLockWindow && !ac65Authorized && !ruledHistorical`。`checkDirectCommits` 加 `ruledHistoricalCommits` 计数。CLI：candidate 报 `ruledHistorical`/`ruledReason`，human 输出 tag `RULED-HISTORICAL`（与 `AC65-AUTHORIZED` 区分），denominator 加 `ruledHistoricalCommits`。⛔ AC65 两谓词机制未动（判据3 不松动）；豁免表有界（只覆盖 cddc55e2，非入表新直投仍红——能取假）。

**CLI 回放 cddc55e2（AC1）**：
```
$ node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root . --commits cddc55e2 --json
evaluated=true ok=true reason="ac65-authorized-or-ruled-historical-only"
candidates[0]: sha=cddc55e2 ruledHistorical=true confirmedBypass=false ac65Authorized=false
ruledReason="inner 紧急回退自己刚造成的破坏——cddc55e2 回退的 232e4171 是 inner 在双副本漂移上的试错；非偷懒绕过 fan-in，不属于 detector 要抓的那一类。manager 2026-08-15 裁定 ruled one-off…"
human 输出: RULED-HISTORICAL cddc55e2 — …（tag 与 AC65-AUTHORIZED 区分）
```
**CLI 回放 7e64a86b（AC2 能取假）**：
```
$ node --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root . --commits 7e64a86b --json
evaluated=true ok=false reason="direct-commit-bypasses-fan-in"
candidates[0]: sha=7e64a86b confirmedBypass=true ac65Authorized=false ruledHistorical=false
exit=1（非入表真直投仍红）
```
**全量扫描（生产基线 b11ce720）**：`evaluated=true ok=true reason="ac65-authorized-or-ruled-historical-only"`，candidates 3 条（62853261 ac65 / cddc55e2 ruled / 6620f9c9 ac65）全 `confirmedBypass=false`，denominator ruledHistoricalCommits=1，无真直投红。

**判据3（声明∧无验证⇒红）保持**：既有测试 `PURE classifyCommit — AC65 两谓词`（declOnly 断言）不变；新增 ruled 测试含同形断言——`AC65: 声明`（无 `AC65-Verified:`）∧ 非入表 sha ⇒ `ac65Authorized=false, ruledHistorical=false, bypass=true`（红）。

**测试**：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs` → 26/26 pass（新增 6 条 ruled 用例：findRuledHistoricalEntry 前缀匹配+有界、classifyCommit cddc55e2→ruledHistorical/真直投仍红/判据3、checkDirectCommits 混合只红真直投、真实 git 回放 cddc55e2 不再误标、CLI cddc55e2 exit0 + 7e64a86b exit1 + 混合、CLI 全量扫描基线 ok=true）。
**scoped 门**：`scripts/test.sh --for-task gap-direct-to-develop-ruled-historical-cddc55e2 --allow-thin` → EXIT=0，静态检查全 PASS（含 malformed-task-check、test-isolation、concurrency、delivery-inventory），26/26 测试绿。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（ruled 豁免表 + ruledHistorical 分类）
- plugin/test/direct-to-develop-bypass-check.test.mjs（对应测试）
- tasks/gap-direct-to-develop-ruled-historical-cddc55e2.md（自身）

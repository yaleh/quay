---
id: gap-readme-design-internal-exclusion
title: README.md 加进 direct-to-develop-bypass-check design-internal 排除集 + b67a91cf 入 ruled 表
status: todo
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

**来源**：manager 2026-08-24 裁定 a+b（outer 补 README 的提交 `b67a91cf` 触发 bypass 红——README.md 不在 design-internal 排除集）。

**现象（实测）**：`direct-to-develop-bypass-check --baseline b11ce7202b46406d5d5bc82ef7b4c030c4aed05b --json` → `ok:false`，candidate=`b67a91cf`，`codeSurfaceFiles:["README.md"]`，`confirmedBypass:true`。排除集（`isDesignInternalPath`，:106 / predicate :694）已含 `CLAUDE.md` 但**漏了 README.md**（同类：纯 prose、仓库根、不被测试/构建解析）。

**修法（manager 裁定 a+b，⛔ 不扩范围）**：
- **(a) 根修**：`isDesignInternalPath` 加 `README.md`（同 CLAUDE.md 先例）。
- **(b) 快修**：`b67a91cf` 进 `RULED_HISTORICAL_COMMITS`（理由=manager 委托 outer 写 README、非绕过意图）。

**⊢ 已验证不扩范围（manager 令「逐个验证，不要照单全收」）**：repo-root 文档里 `LICENSE`（被 npm-pack-e2e / package-json-bin 读）、`CHANGELOG.md`（同左）、`AGENTS.md`（被 codex-stage1-adapter 读）——**三者都被测试/构建读取，非纯 prose，⛔ 不加入排除集**。只加 README.md。

**⛔ 落地路径**：本任务改的是 `direct-to-develop-bypass-check.ts` 自身，**必须走正常 fan-in**（ff-merge 是 merge 非 commit，不会被本 checker 自己拦；⛔ 不要直接 commit——头注释 :228 self-referential-deadlock 警告，99f845d9 已踩过同坑）。

## Plan

1. `isDesignInternalPath` 加 `README.md`（同 CLAUDE.md 位置）。
2. `RULED_HISTORICAL_COMMITS` 加 `{sha: "b67a91cf", reason: manager 委托 outer 写 README、非绕过意图}`。
3. 走正常 fan-in 落地。

## Acceptance Criteria

- [ ] AC1（根修，能取假）：README.md 直接提交不再报 bypass（design-internal）；⛔ 仍报 ⇒ 假。
- [ ] AC2（快修，能取假）：b67a91cf 分类 ruledHistorical（非 bypass、非 ac65Authorized）。
- [ ] AC3（不扩范围，能取假）：LICENSE / CHANGELOG.md / AGENTS.md 仍 code-surface（直改仍红）。

## Definition of Done

- [ ] README.md 入排除集 + b67a91cf 入 ruled 表 + 其余 repo-root 文档仍 code-surface；AC1-3 全勾；正常 fan-in land。

## Retires

- 无

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（isDesignInternalPath 加 README.md + RULED_HISTORICAL_COMMITS 加 b67a91cf）
- plugin/test/direct-to-develop-bypass-check.test.mjs（test：README.md 豁免 + LICENSE 等仍红）
- tasks/gap-readme-design-internal-exclusion.md（自身）

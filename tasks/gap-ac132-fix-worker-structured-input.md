---
id: gap-ac132-fix-worker-structured-input
title: AC132 不合格者 → 短命 fix worker（输入须为闸的结构化 missing）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac130-promotion-driver-resident-loop
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC132`，⛔ 不在此复制，读那一段）。

**形态**：判定不合格的任务，驱动 spawn 短命 `claude -p` fix worker，其输入必须是【任务 id + 闸的结构化 missing 清单】（如 `fourArtifacts=false missing=[DoD]` / `touchesResolve=false` 及原因），⛔ 非「你去看看哪儿不对」散文指令。

**作用域直接沿用 A24 分类**（`orchestrator-tick-core.md:48`，⛔ 不重新设计一套）：
- 可修类：`fourArtifacts=false`（按 missingArtifacts 补 shape 缺失段）/ `selfTouchOk=false`（补自身 tasks/<id>.md 进 ## Touches）/ `touchesResolve=false`（Touches 写错 ⇒ 改对）
- 不可修类（逐条记原因、不修）：`depsReady=false` / `retiredMechanism` / `superseded` / `compound` / `prosePrereqGap` 非空

**依据（今日三实测）**：全角字符 Touches（`5f2b896f` 修）· DoD<40（`ca9ed1e8` 修）· AC115 Touches 三次扩充——共同形态：闸能报「哪项不合格」，「补什么内容」是语义问题 ⇒ 机械判定 + LLM 修复的分界。

## Plan

1. promotion-driver.ts 加 fix worker spawn：不合格 → 短命 `claude -p`，输入 = 任务 id + 结构化 missing 清单（沿用 A24 分类）。
2. 取假验证：构造 DoD<40 的 todo ⇒ fix worker prompt 必须含结构化缺项标识。

## Acceptance Criteria

- [x] AC1：判定不合格的任务，驱动 spawn 短命 `claude -p` fix worker，输入必须是任务 id + 闸给出的结构化 missing 清单（沿用 A24 可修三类/不可修五类），⛔ 不得是散文指令。
- [x] AC2（能取假）：构造 DoD<40 字符的 todo ⇒ fix worker 收到的 prompt 中必须含该结构化缺项标识；若 prompt 只有任务 id 而无缺项清单 ⇒ 本条为假。

## Definition of Done

- [x] fix worker 结构化输入落地（沿用 A24 分类）；AC1-2 全勾（含缺项标识取假）；land 到 develop。

## Retires

- 无（新增机制）

## Touches

- plugin/scripts/promotion-driver.ts（fix worker 结构化输入）
- plugin/test/promotion-driver.test.mjs（缺项标识取假）
- tasks/gap-ac132-fix-worker-structured-input.md（自身）

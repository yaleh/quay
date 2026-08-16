---
id: gap-ac66-a22-checker-loose-pattern
title: "ac66-a22-agent-id-check 的 extractA22ReadingLines 太松——状态注记被匹配成读数行，缺 agent id 恒 RED（发生率 3，结构性）"
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

**来源**：inner 2026-08-16 20:3xZ（发生率给数 + 结构性论证）。

**问题**：`ac66-a22-agent-id-check.ts` 的 `extractA22ReadingLines` 用 loose pattern 匹配「A22 读数行」：
```
A22_TOPIC_RE   = /(?:^|[\s>*-])\**A22\b/
A22_READING_RE = /心跳|读数|晋|无晋|心跳已跑|POOL|deficit|promotions|pool/
```
**任何【提及 A22 且含上述任一机制词】的行都会被当成 A22 读数行**——包括状态注记。

**实证（outer 20:28Z 状态注记被误匹配）**：`「**A22 第 2 次同形修复（ac66 PASS）**…A13 结构问题…」`——
含 A22 topic + 机制词（拒因/A13 语境），被当成读数行，无 agent id ⇒ RED，并把真实读数行（20:27 带 id）挤成非最新。

**发生率 3 + 结构性**：18:47（outer 读数行缺 id）/ 20:26（outer 读数行缺 id）/ 20:28（outer 状态注记被误匹配）。
前 2 次是 outer 格式问题（已修 + 模板加固），第 3 次暴露 checker 精度缺陷——**单靠外层注意格式治不了**，
因为状态注记（修 A22 / 讨论 A13）必然提及「A22」。

## Acceptance Criteria

- [ ] AC1: `extractA22ReadingLines` 收紧——只匹配「真 A22 读数」形态（如 `**A22 读数**` 开头，或
      含 pool/floor/deficit/promotions 数字的行），**不匹配状态注记**（提及 A22 但无数读数的行）。
- [ ] AC2: 判据能取假——构造一条「提及 A22 + 机制词但无数读数」的注记 ⇒ 必须**不**被匹配为读数行。
- [ ] AC3: 真实 A22 读数行（带 pool/floor/deficit/promotions 数字）仍被正确匹配 + 判 agent id。

## Definition of Done

- [ ] checker 只匹配真 A22 读数行，状态注记不再误触发；发生率 3 的结构性根因消除。

## Touches

- plugin/scripts/ac66-a22-agent-id-check.ts（extractA22ReadingLines 收紧）
- plugin/test/ac66-a22-agent-id-check.test.mjs（负控制：状态注记不匹配）
- tasks/gap-ac66-a22-checker-loose-pattern.md（自身）

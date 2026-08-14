---
id: gap-ac57-preference-change-notification
title: AC57 通知面——倾向变更 SendMessage 只通知不承载内容（「变了，去重读」+ 指纹）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac54-dispatch-preference-file
---

**type:** execution

## Proposal

**AC57（通知面）判据（phase-goal 逐字 + manager 7e7aa61b 补能取假）**：
- **义务**：倾向变更的通知**不得包含倾向内容本身**，只说「倾向变了，去重读」+ 指纹。
- **理由（SPEC §4.1）**：消息 **compact 后不可重读**、**无单一正本**、**无法验证用的是哪一版**——三条失败模式已在当日实证（最有价值的 A19 规格幸存是因为 outer 抄进了任务体，不是因为消息还在）。
- **能取假（7e7aa61b 补，AC49 判据1 标准：一个从未在真实历史样本上亮过红的判据不算判据）**：
  **拿一条真实的倾向变更通知回放——若它携带了倾向内容本身（而非仅「变了+去重读+指纹」）⇒ 必须报红。**
- **⚠️ 如实写明 AC57 比另三条难核，不假装**：通知是**消息不是文件**，需要一个**可核载体**（发送侧留痕 / 接收侧记录 / 或复用 AC55 的派发记录字段）。
  **载体形态归 outer+inner 设计，不规定**（同 SPEC §7「不规定倾向文件的路径与格式」——实现面）。
  **若证明任何载体都不可得 ⇒ AC57 应降为观察项并明说**，而不是留一条无法证伪的判据挂着——那正是 A14/B3-戊 那一族（不可能红的判据与「一切正常」同形）。

**本任务不新建过程纪律型 AC**：负控制沿用既有 AC49。

## Plan

1. 倾向变更时，通知（SendMessage）只含「倾向变了，去重读」+ 倾向文件内容指纹，**不承载倾向内容本身**。
2. 写检查器验证通知不含倾向内容（只含指纹 + 通知语）——若有倾向内容泄漏 ⇒ 红。
3. 负控制：构造一个含倾向内容的通知样本 ⇒ 必须红（AC49 判据1 归属限定）。

## Acceptance Criteria

- [ ] AC1 倾向变更通知只含「变了，去重读」+ 指纹，不承载倾向内容。
- [ ] AC2 检查器验证通知不含倾向内容（泄漏 ⇒ 红）。
- [ ] AC3 负控制：含倾向内容的通知样本 ⇒ 红。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 通知模板（指纹 + 通知语）+ 检查器 + 负控制红。
- [ ] 与 AC54 文件对接（通知引用的是 AC54 文件的指纹）。

## Touches

- （外层 SendMessage 通知模板/流程）
- （检查器 + 负控制 fixture）
- tasks/gap-ac57-preference-change-notification.md（自身）

## Evidence

（落地后回填）

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

- [x] AC1 倾向变更通知只含「变了，去重读」+ 指纹，不承载倾向内容。
- [x] AC2 检查器验证通知不含倾向内容（泄漏 ⇒ 红）。
- [x] AC3 负控制：含倾向内容的通知样本 ⇒ 红。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 通知模板（指纹 + 通知语）+ 检查器 + 负控制红。
- [x] 与 AC54 文件对接（通知引用的是 AC54 文件的指纹）。

## Touches

- orchestration/preference-notification-log.md（可核载体——发送侧留痕：AC57 通知模板 + 留痕记录）
- plugin/scripts/preference-notification-check.ts（检查器——通知语 + 指纹 + 无泄漏判定）
- plugin/test/preference-notification-check.test.mjs（测试：真实模板绿 + 负控制泄漏红）
- plugin/scripts/checker-mutation-cases/preference-notification-check.sh（mutation case——注入泄漏通知 ⇒ 红）
- plugin/scripts/capability-catalog.sh（五表声明）
- scripts/test.sh（接入 run_static_checks，@static-tier change）
- docs/proposals/quay-product-outline.md（`--write-inventory` 重新生成 §6 DELIVERY-INVENTORY 快照）
- tasks/gap-ac57-preference-change-notification.md（自身）

## Evidence

**可核载体（落地方设计，SPEC §7 不规定）**：发送侧留痕 = `orchestration/preference-notification-log.md`
（git 可见、不在 gitignored 的 `.quay/` 下——抗 compact、跨会话重启存活）。通知是消息不是文件 ⇒ 留痕日志是
让通知可核的载体；发送者（manager）每次 SendMessage 倾向变更通知时把通知的确切文本逐字追加进
「## 留痕记录」段，检查器逐条验证。载体可得 ⇒ AC57 保持完整判据，未降观察项。

**AC1（通知只含「变了，去重读」+ 指纹，不承载内容）**：通知模板 = `倾向变了，去重读` + `重读正本：
orchestration/dispatch-preference.md` + `指纹：<git blob hash>`。指纹 = 倾向文件
`orchestration/dispatch-preference.md` 的 git blob hash（`git hash-object`，= `e4881984…`，DoD 与 AC54 对接）。
模板只含通知语 + 路径 + 指纹，不含任何倾向内容行。检查器 `preference-notification-check.ts` 的
`checkNotificationText` 验证：含通知语、指纹匹配当前倾向文件的 git blob hash、且无任何倾向内容行泄漏。

**AC2（检查器验证通知不含倾向内容，泄漏 ⇒ 红）**：检查器对通知做三判：①含通知语 `倾向变了，去重读`；
②指纹匹配当前倾向文件 git blob hash（回答「用的是哪一版」）；③泄漏检测——把倾向文件的实质内容行
（默认/覆盖/维护者三段的策略句，normalize 掉 markdown 与空白后 ≥12 非空字符）逐一子串匹配通知，
任一命中 ⇒ RED。`plugin/test/preference-notification-check.test.mjs` 14 条全绿。

**AC3（负控制：含倾向内容的通知样本 ⇒ 红）**：真实模板 + 逐字倾向行（`红窗优先：存在红色（失败）继承/
未收敛红窗时，优先派发与其直接相关的任务。`，真实文件的默认段原句）⇒ 检查器 RED（exit 1）：
```
RED: notification sample (--text) — leaks preference content (1 content line(s) present)
  leak: …红窗优先：存在红色（失败）继承/未收敛红窗时，优先派发与其直接相关的任务。…
```
同一模板去掉该行 ⇒ GREEN（证明红的是泄漏本身，不是模板形态）。mutation case
`checker-mutation-cases/preference-notification-check.sh`（GREEN → 注入泄漏记录 → RED → 恢复 → GREEN）通过。

**AC4（既有测试 + scoped 门）**：`scripts/test.sh --for-task gap-ac57-preference-change-notification
--allow-thin` 全绿（见提交时输出）；capability-catalog 自检 0 unclassified；`--write-inventory` 已重新生成
DELIVERY-INVENTORY（scripts 228→229）。

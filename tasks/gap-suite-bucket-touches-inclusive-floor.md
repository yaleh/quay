---
id: gap-suite-bucket-touches-inclusive-floor
title: bucket 选择强制包含任务 Touches 测试文件——改了测试必须跑它（不依赖归因判定）；否则「改了测试文件但 fan-in 不跑」结构上可能
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

bucket selection 的选中集 = `触发的桶 ∩ 测试桶集`（`suite-bucket-select.ts`）。**它不强制包含任务 Touches 里列出的测试文件** ⇒ 一个任务**改了测试文件但该测试因归因被归到别的桶，fan-in 不跑它**。

**实证**（gap-suite-bucket-attribution-pathjoin-run-header-blind-spot 时发现）：`gap-fan-in-workflow-lock-stale-runid-detached-holder` 的 Touches 含 `fan-in-workflow-lock.test.mjs`（S 归因）与 `fan-in-ff-merge.test.mjs`（S pin），M 触发的桶选择把它们排除（250 文件不含）——**任务改了这两个测试文件但 M 桶 suite 不跑它们**。归因修复后纳入，但**依赖归因正确**这个前提本身不可靠（静态代理有盲区）。

**机制判据**：任务的 Touches 是「这个任务改了哪些文件」的**直接声明**。改了测试文件而不跑它 = 改动未验证。这是强约束，不该由归因（代理）来兜。

## Plan

1. **选择侧并集**：`suite-bucket-select.ts` 的选中集 = `(触发的桶 ∩ 测试桶集) ∪ (任务 Touches 里列出的测试文件)`。`taskTouchEntries`（suite-bucket-hub-list.ts）已能读 Touches，把其中以 `.test.mjs`/`.test.ts` 结尾的条目并入选中集。
2. **只并入测试文件**：Touches 里的非测试条目（源文件/脚本/自身）不并入（选中集是测试文件集合）。
3. ⛔ 不改桶归因本身——归因继续决定「该任务触发的桶子集」，Touches 下限是额外的保证。

## Acceptance Criteria

- [ ] AC1（能取假，Touches 测试必含）：一个 Touches 列出 `fan-in-workflow-lock.test.mjs`（S 归因）的任务触发 M 桶 ⇒ 选中集含它（⛔ 仍被排除 ⇒ 假）。
- [ ] AC2（能取假，非测试条目不并入）：Touches 里只有源文件/脚本的任务 ⇒ 选中集不变（⛔ 被并入了非测试文件 ⇒ 假）。
- [ ] AC3（能取假，负控制）：未在 Touches 里的测试仍按桶归因选择（⛔ 全部测试被并入 ⇒ 假）。
- [ ] AC4（能取假，selection 不退化）：原 bucket 选择行为对不含测试 Touches 的任务不变（⛔ 触发的桶语义被破坏 ⇒ 假）。

## Definition of Done

bucket 选择强制包含任务 Touches 的测试文件；非测试条目不并入；未在 Touches 的测试仍按归因选择；AC1-AC4 全勾；「改了测试却不跑」结构上不可能。

## Touches

- plugin/scripts/suite-bucket-select.ts（选中集并入 Touches 测试文件）
- plugin/test/suite-bucket-select.test.mjs（Touches 并入 + 负控制测试）
- tasks/gap-suite-bucket-touches-inclusive-floor.md（自身）

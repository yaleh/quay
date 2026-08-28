---
id: gap-ac145-semantic-face-subagent-manager-driven
title: AC145 语义面 subagent 化 + 由 manager 后台驱动（任务撰写/需求分析/升级/学习/AC65快修/B16-C/B18/跨层纠错）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

这些职责结构上不能是 driver（driver 读不出「听起来自洽但错了」的因果故事）：任务撰写/立案 · 需求分析 · 升级判断（B11）· 学习（B10）· AC65 快修判断 · B16-C 类冲突意图 · B18 止损 · **跨层纠错**。由 manager 派**后台 subagent** 执行，非主线程直接做。跨层纠错必须单列（本会话三实证：outer 自诊断错、manager 过度声称、manager 过早归因——全部由另一层读散文发现）。

## Plan

manager 侧落「语义面 subagent 派发」机制（同 A16b dispatch-record 形态），每类职责有可查派发记录；复用 inner A24 `main_thread_edits > 0` 判据形态守「manager 主线程不做产品文件编辑」。

## Acceptance Criteria

- [x] AC1（能取假，后台 subagent）：上述职责由 manager 派后台 subagent 执行，非 manager 主线程直接做；取假 = manager 主线程出现产品文件编辑（复用 inner A24 `main_thread_edits > 0` 判据）；（⛔ 主线程编辑 ⇒ 假）。
- [x] AC2（能取假，可查派发记录）：每类语义职责有可查派发记录（同 A16b dispatch-record 形态）；取假 = 发生一次语义产出而无对应派发记录；（⛔ 无记录 ⇒ 假）。

## Definition of Done

语义面 subagent 化 + 派发记录机制落地；AC1/AC2 全勾；跨层纠错职责单列且有派发记录。

## Touches

- plugin/scripts/semantic-face-dispatch-record.ts (new)（语义 subagent 派发机制 + 派发记录，同 A16b dispatch-record 形态）
- plugin/test/semantic-face-dispatch-record.test.mjs (new)（派发记录可查性测试）
- plugin/scripts/dispatch-record.ts（A16b 参照形态）
- plugin/scripts/capability-catalog.sh（六表声明——QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照 scripts 296→297）
- .gitignore（orchestration/semantic-face-dispatch-record.jsonl 运行时遥测条目）
- orchestration/manager-tick-core.md（语义面职责清单 + 派发规范）
- orchestration/manager-tick-criteria.md（语义面职责清单）
- orchestration/manager-tick-sending.md（语义面派发规范）
- orchestration/manager-tick-closing.md（语义面职责清单）
- orchestration/dispatch-preference.md（派发偏好——语义面覆盖段）
- tasks/gap-ac145-semantic-face-subagent-manager-driven.md（自身）

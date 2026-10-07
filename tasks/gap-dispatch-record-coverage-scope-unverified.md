---
id: gap-dispatch-record-coverage-scope-unverified
title: dispatch-record.jsonl / semantic-face-dispatch-record.jsonl
  的记录条数远低于机械派发实际发生次数，需先核实覆盖范围是否符合设计意图（不要直接当缺陷修）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
## Finding

一次用量定量核实发现 `orchestration/dispatch-record.jsonl` 只有 301 行、`orchestration/semantic-face-dispatch-record.jsonl` 只有 6 行，而在 27111-commit 的完整历史中「机械 fan-in」落地归因单独出现 1160+ 次、「机械晋升」（mechanical promotion）归因出现 1111+ 次。`plugin/scripts/dispatch-record.ts:108` 的 `appendRecord` 与 `plugin/scripts/semantic-face-dispatch-record.ts:126` 的 `appendSemanticFaceRecord` 是全库唯一找到的写入方。

**当前未知**这两个记录是否*意图*覆盖每一次派发决策（若是,这个低计数就说明大多数派发没有被记录——真实缺陷），还是*有意*窄范围（例如只覆盖 LLM 中介的「selector 挑选」路径，刻意排除每一次机械批量晋升/fan-in 事件）——这一点**尚未被判定**，按本项目自己宣称的纪律（不把未经验证的前提当缺陷处理），本任务必须定位为**调查**，不是预设方案的修复。

Proposed action：本任务的 AC 应是判定每个记录的设计意图覆盖范围（阅读与这两个机制绑定的设计文档/spec——别处提到的 `fast-mode-tick-core.md` A16b 给 dispatch-record，以及一份 manager 语义派发的「C30/AC145」spec 给 semantic-face 的那个——并对比 `appendRecord`/`appendSemanticFaceRecord` 的实际调用点与那些**不**调用它们的机械晋升/fan-in 调用点），得出结论**二选一**：「确认是非预期的覆盖不足 → 立一个后续修复任务」或「窄范围是设计意图 → 记录为已阅无需动作，关闭」。⛔ 不要把本任务的 AC 写成「给所有派发路径加日志」——那是在调查完成前就预设了修复方案。

## Acceptance Criteria

- [ ] 读取并引用 `fast-mode-tick-core.md` A16b（dispatch-record 的设计意图段落）与 manager 语义派发的「C30/AC145」spec（semantic-face-dispatch-record 的设计意图段落），摘录其对覆盖范围的原文声明（若原文未明确声明范围，记录为「未声明」而非猜测）
- [ ] 列出 `appendRecord`/`appendSemanticFaceRecord` 的全部实际调用点（文件+行号）
- [ ] 列出全库机械晋升/fan-in 的调用点中，**不**调用上述两个记录函数的那些（文件+行号），作为「潜在未覆盖」清单
- [ ] 基于以上两份清单与设计文档声明，得出明确结论：「覆盖不足属非预期缺陷」或「窄范围属设计意图」，并写明判断依据
- [ ] 若结论为「非预期缺陷」，在本任务体中列出后续修复任务的 id/标题（可另开新任务，不在本任务范围内直接实现修复）；若结论为「设计意图」，本任务可直接作为调查文档关闭,不新开修复任务

## Definition of Done

调查完成，结论二选一且有证据支持（调用点清单 + 设计文档引用）；若判定为缺陷,后续修复任务已登记（但不要求在本任务内实现）；若判定为设计意图,任务作为调查记录关闭。

## Touches

- plugin/scripts/dispatch-record.ts
- plugin/scripts/semantic-face-dispatch-record.ts
- orchestration/dispatch-record.jsonl
- orchestration/semantic-face-dispatch-record.jsonl
- tasks/gap-dispatch-record-coverage-scope-unverified.md

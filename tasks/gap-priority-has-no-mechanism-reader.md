---
id: gap-priority-has-no-mechanism-reader
title: 优先级没有机制读者——P1/P2 写在散文里，--apply 按 disjointness-first 字典序取前 deficit
  个；修=priority label 在可行集内 tiebreaker，不越过安全约束（C17 闭合）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**优先级没有机制读者——写在散文里的决定，机制按另一套序执行（C17：守与不守在记录上不可区分的规则，只能靠意志）。**

**实证（manager 2026-08-13）**：`ready-pool-check --apply` 的取法（C6，读实现）是 `for (c of candidates) { if (promotions.length >= deficit) break; … }` —— **按序取前 deficit 个**。排序依据（`:29`）是 `touch-disjointness FIRST … then gap-* before DIR-* … then touches-resolvable`，`:1571` `ready.sort()` 字典序——**没有「重要性」维度**。⇒ 我标 P1（spec-11 试点，停全局轮的唯一前置）与 P2（ac44），mechanism 会挑切线外另 5 条（本轮靠 --in-flight 集合变化让 P1/P2 挤进前 5 才晋——**是运气，不是优先级在读**）。

**形状（比排序本身更值得记）**：「我写 P1/P2」+「你回已按优先级落」两句都真，机制挑另外五个——**记录上无法区分「优先级被遵守」与「优先级根本没有读者」**。试点是停全局轮的唯一前置，它排在切线外，**没有任何东西会报出这一点**，除非有人手动去数。

## 设计（manager 2026-08-13，裁定权 outer）

**不要把优先级塞进现有排序覆盖 disjointness**——两者不是同一类：
```
touch-disjointness = 安全约束（并发正确性）——不可让步
优先级            = 偏好——只能在【已经安全】的集合内部决定先后
```
⇒ 正确复合：**disjointness 先筛出可行集，优先级在可行集【内部】做 tiebreaker，永不越过安全约束。**

**载体**：`:1333` 注释「Same frontmatter-labels source the dispatch sort reads」——**labels 已被派发排序读**，优先级搭在一个 label 上（如 `priority:p1`），不必新造字段。

**准确表述（manager 2026-08-13，避免重造 done 任务）**：前身 `gap-value-prioritization-has-no-mechanism` 已 done（AC1-4 全勾），其 AC4 逐字「不削弱现有机制——gap>DIR 顺序保留」⇒ relevance 信号当初【被刻意隔离在晋升切线之外】。所以不是「优先级没有机制」而是：**机制建好了但有意不接切线；而现在即使接进去也没用，因为它退化了**（value 信号退化见 `gap-value-priority-signal-degraded-to-1-over-cost`——三轴全 N、value=1/cost、大任务垫底）。**本任务 = 显式 `priority:` label tiebreaker（排序读不读 label 的缺陷）；退化 = 独立缺陷（信号本身失效），分两条。**


## Plan

1. `plugin/scripts/ready-pool-check.ts` 排序：disjointness 筛出可行集后，`priority:` label 做 tiebreaker（p1 > p2 > 无），不越过 disjointness/safety。
2. 为试点（spec-11）+ ac44 打 `priority:p1` / `priority:p2` label（试点是停全局轮唯一前置）。
3. 测试：两任务同 disjoint 集内，priority label 改变推荐序；priority 永不覆盖 disjointness（不安全的更高 priority 不越位）。

## AC

- [ ] AC1: ready-pool 排序在可行集（disjoint）内部按 `priority:` label tiebreaker（p1>p2>无），不越过安全约束
- [ ] AC2: 试点（spec-11）标 `priority:p1`、ac44 标 `priority:p2`——优先级有机制读者（C17 闭合）
- [ ] AC3: priority 不覆盖 disjointness（不可让步的安全约束保持优先）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 实测：有/无 priority label 的推荐序对照贴出（P1/P2 从切线外到切线内）
- [ ] 全量套件绿

## Touches

- plugin/scripts/ready-pool-check.ts（排序 tiebreaker）
- tasks/gap-spec-11-stage-2-per-task-full-suite-pilot.md（priority:p1 label）
- tasks/gap-ac44-concurrent-phases-read-host-parallelism.md（priority:p2 label）
- plugin/test/ready-pool-check.test.mjs（priority tiebreaker + 不越过 disjointness 用例）
- tasks/gap-priority-has-no-mechanism-reader.md（自身）
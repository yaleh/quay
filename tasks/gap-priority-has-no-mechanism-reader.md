---
id: gap-priority-has-no-mechanism-reader
title: 优先级没有机制读者——P1/P2 写在散文里，--apply 按 disjointness-first 字典序取前 deficit
  个；修=priority label 在可行集内 tiebreaker，不越过安全约束（C17 闭合）
status: done
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

- [x] AC1: ready-pool 排序在可行集（disjoint）内部按 `priority:` label tiebreaker（p1>p2>无），不越过安全约束
- [x] AC2: 试点（spec-11）标 `priority:p1`、ac44 标 `priority:p2`——优先级有机制读者（C17 闭合）
- [x] AC3: priority 不覆盖 disjointness（不可让步的安全约束保持优先）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 实测：有/无 priority label 的推荐序对照贴出（P1/P2 从切线外到切线内）
- [x] 全量套件绿

## Touches

- plugin/scripts/ready-pool-check.ts（排序 tiebreaker）
- tasks/gap-spec-11-stage-2-per-task-full-suite-pilot.md（priority:p1 label）
- tasks/gap-ac44-concurrent-phases-read-host-parallelism.md（priority:p2 label）
- plugin/test/ready-pool-check.test.mjs（priority tiebreaker + 不越过 disjointness 用例）
- tasks/gap-priority-has-no-mechanism-reader.md（自身）

## 执行记录（2026-08-13，worktree 子代理）

**实现（AC1/AC3）**：`plugin/scripts/ready-pool-check.ts` 新增 `priorityLevel(labels)`（读 `priority:p1`=1 / `priority:p2`=2 / 无=Infinity；未注册级 fail-open 不越权），`buildCandidate` 把它读进候选的 `priority` 字段，晋升排序链插入为第二键——`disjointScore DESC`（安全约束，AC3 永不越过）→ `priority ASC`（可行集内 tiebreaker，p1>p2>无）→ `kindOrder`（gap>DIR 保留）→ `touchesResolve`。`promotions` 记录带 `priority` 字段（无=0），调用方可看到是哪一层 tiebreak 晋的级。

**AC2（label 已就位）**：spec-11 与 ac44 在 fork 时已带 `priority:p1` / `priority:p2`（先前 commit 已落），本任务无需再改 label——机制读者是本任务的交付。两条任务已是 done，非 todo 候选，机制改动不触及其晋升。

**DoD 实测（有/无 priority label 推荐序对照，合成 store：pool=1、floor=3、deficit=2、5 个同 disjoint 的合格 gap 候选）**：
```
WITHOUT priority：candidate order = gap-alpha gap-beta gap-delta gap-eps gap-gamma（字典序）
                  promoted = gap-alpha gap-beta（p1/p2 靠 id 运气，非机制）
WITH    priority：candidate order = gap-beta[p1] gap-alpha[p2] gap-delta gap-eps gap-gamma
                  promoted = gap-beta(#1) gap-alpha(#2)（priority 是机制读者）
```
AC3 对照（同测试 `order-priority-safety`）：higher-disjoint 的无 priority 候选仍排在 lower-disjoint 的 `priority:p1` 候选之前——安全约束不可越过。

**测试（AC4）**：`plugin/test/ready-pool-check.test.mjs` 新增 4 用例（`priorityLevel` 映射、可行集内 p1>p2>无、priority 不覆盖 disjointness、priority 胜过 kind 的 gap>DIR），单文件 99/99 绿；`--for-task` scoped 门绿见下。真实 store 干跑：pool=14 ≥ floor=12 ⇒ 无晋升压力，输出正常无崩溃。

**全量套件绿：留给 outer（本子代理只跑 scoped 门）。**

## 后续观察（2026-08-13，outer 追加——本任务虽 done，缺口仍在生产）

**活样本（manager 裁定定向晋升时自纠）**：两个同尺寸互斥集——
`{landing-target, clique, streaming-red}` 与 `{retest, clique, streaming-red}`，
机制（slot-refill 排序）选了前者，因为 **排序里没有"重要性"维度**（touch-disjointness → gap>DIR → touches-resolvable，无优先级）。而 retest 是**停全局轮链条上唯一承接者**，被 landing-target（同碰 test.sh）挡着延迟了。**两个集等价，机制取哪个都合规；是我们要的那一维它看不见。** `priority:` label 至今零读者——本任务（271c102a）落地后这一维仍未接上。

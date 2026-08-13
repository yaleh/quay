---
id: gap-red-window-cap-trigger-backlog-not-suite-red
title: 红窗降 cap 触发条件过严——`suite_red && backlog>50` 双条件（backlog=10 未达 ⇒ 红窗 cap 仍 5）；人裁定红窗本身即触发降 cap + red_backlog_cap=2 字面量需记录 + 不得停派（死锁）
status: todo
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

**实测（manager 2026-08-13，slot-refill arbitration）**：
```
suite_red           = True
red_window_active   = True
integration_backlog = 10
backlog_threshold   = 50      ← 未达阈值
red_backlog_cap     = 2       ← 收窄后的目标 cap，已定义
cap_narrowed        = False   ← 所以【没有收窄】
effective_cap       = 5 = base_cap
```
**现行触发 = `suite_red && backlog > 50` 双条件**；backlog 才 10 ⇒ 红窗里 cap 仍是 5。
**人 2026-08-13 08:1xZ 裁定**：「红窗在主会话修」这个规则后续可以取消。**红窗时可以减少 subagent 数量，
但不要在主会话修** ⇒ 红窗降并发 = **红窗本身触发降 cap**：`red_window_active ⇒ cap → red_backlog_cap`，
不再要求 backlog 超阈值。这是一处条件放宽，不是新机制。

**⚠️ 不得把红窗改成停派**：实测 `should_refill=True / dispatchable_disjoint=10 / slots_free=5`——
红窗没停派。**降 cap ≠ 停派**；与「不在主会话修」组合成停派 = **死锁**（不能派、又不能主线程 ⇒
红窗里什么都做不了）。实现 ① 时不得顺手把红窗改成停派。

**red_backlog_cap = 2 字面量（硬规则4推论二）**：写死数字的合理性依赖机器规格（同 `cpuQuota:"400%"` 族）。
人说不搞复杂——先**记录可追溯**：为什么是 2、什么时候要改（或改读宿主派生，但非本次）。

## Plan

1. `slot-refill.ts` arbitration 触发条件：`suite_red && backlog > 50` → `red_window_active`（红窗本身触发降 cap）。
2. **不把红窗改成停派**（降 cap 保持派发）。
3. `red_backlog_cap = 2` 的缘由记录进任务体/档案（为什么 2、什么时候要改）。

## AC

- [ ] AC1: `red_window_active ⇒ cap 收窄到 red_backlog_cap`（不再要求 backlog > 阈值）
- [ ] AC2: 红窗保持派发（降 cap 不停派——should_refill 逻辑不变）
- [ ] AC3: `red_backlog_cap = 2` 缘由记录（为什么 2、什么时候要改）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 红窗下 cap 收窄 + 仍派发的对照样例贴出
- [ ] 全量套件绿

## Touches

- plugin/scripts/slot-refill.ts（arbitration 触发条件）
- tasks/gap-red-window-cap-trigger-backlog-not-suite-red.md（自身）

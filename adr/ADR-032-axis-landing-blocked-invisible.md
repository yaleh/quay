---
id: ADR-032
title: "AXIS 落地能力不可见：派发闸能看见'能不能派'，看不见'能不能落地'"
status: proposed
date: 2026-08-06
tags:
  - axis
applies-to:
  - plugin/scripts/ready-pool-check.ts
  - plugin/scripts/slot-refill.ts
---

## 这根轴问什么

**流水线的健康度，目前只有"派发能力"这一半是可见的。"落地能力"那一半有没有判据？**

## 为什么怀疑这里有东西

管理者 2026-08-06 实测：`ready-pool-check.ts` 与 `slot-refill.ts` **都不读任何
fan-in/合并状态**（grep 到的 `conflict` 是 touches 冲突图，用于判互斥，不是合并冲突）。
⇒ `criterion_met=True` 回答的是"有 ≥cap 个互斥候选可派发"，而 tick 把它当**流水线健康**读。
**落地被结构性阻塞时它照样报 True。**

## 已撞到的同型实例

- 两线模型激活但基线内容未迁移 ⇒ 任务分支 rebase 不到 integration，
  fan-in 全停，而 `criterion_met` 全程为 True；
- 同期真实 merge 间隔 >40 分钟，异常判据靠"距上次 merge 时间"这个**外部**信号才发现，
  派发闸自身对此完全失明。

## 状态

开放。已由外层立案 `gap-landing-blocked-invisible-to-dispatch-criteria`
（本轴的第一个收敛候选——若该任务落地并证明判据可靠，本轴可转 accepted）。

## 对照实例：派发侧有两级判据，落地侧一级都没有（2026-08-06 管理者实测）

本轴的锋利之处，在一次**假的矛盾**里显现得最清楚。

内层报告「pool exhausted」，而 `ready-pool-check` 同时报 `pool 9 / dispatchable_disjoint 4 /
criterion_met: True`。看起来矛盾，实测后**不是**——两者量化的是不同范围：

| 判据 | 量化什么 | 当时的答案 |
|---|---|---|
| `ready-pool-check.criterion_met` | **池子**本身健康吗（有没有 ≥cap 个互斥候选） | True |
| `slot-refill.should_refill` | **此刻、给定在飞任务**，有没有能真派的 | **False**——`no dispatchable candidate passes step-4 checks (touches-resolve / deps-ready / disjoint-from-in-flight)` |

两者都对，各自范围清晰，且内层消费的是**正确的那一个**。

**这正好反衬出本轴**：**派发能力有两级判据（池子级 + 槽位级），而落地能力一级都没有。**
同一时刻，没有任何判据能回答"落地是不是被结构性阻塞了"——
异常判据只能靠"距上次 merge 的时间"这个**外部**信号间接发现。

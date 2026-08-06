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

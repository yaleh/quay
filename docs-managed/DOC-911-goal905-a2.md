---
id: DOC-911
title: goal 分支第二次演练 A-2
status: draft
kind: drill
---

## 演练记录

本文档是 GOAL-905（goal 分支第二次演练）A 批的第 2 篇，内容刻意无害。

### 本篇负责验证什么

**落后 develop 的追平。** `goal/GOAL-905` 是从更早的 `develop` 上分出来的，演练期间
`develop` 仍在被两层循环推进。A 批任务在 fan-in 之前必须先 `git merge develop`，否则
落地回 goal 分支会把 goal 分支带回一个更老的基线上。本篇观测的是这次追平是否真的发生、
以及追平后的差分是否干净。

### 追平的两个方向

| 方向 | 含义 | 反面（要防的） |
|---|---|---|
| goal → develop 追平 | goal 分支拿到 develop 的新提交 | goal 分支越拖越老 |
| task → goal 落地 | 任务提交进 goal 分支 | 任务提交落到了 develop |

两个方向都成立时，`goal/GOAL-905` 才是 `develop` 的超集；任一方向断了，演练都不算成功。

### 记录内容

演练结束时应能在 Evidence 里读到三项：追平前后 `goal/GOAL-905` 相对 `develop` 的
提交计数、追平是否产生冲突（以及冲突是如何解的）、以及最终 fan-in 实际用的 mergeTarget。
如果 mergeTarget 落成了 `develop`，那不是演练成功——那是接线缺陷，必须如实记下。

### 可见性边界

本文档只存在于 `goal/GOAL-905` 上。并入 `develop` 之前，预览实例的 `/doc` 页能列出
`DOC-911`，生产实例列不出；这个「预览有、生产没有」的差异正是演练要采集的读数。

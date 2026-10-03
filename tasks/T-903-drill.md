---
id: T-903-drill
title: GOAL-903 追平落地演练任务（AC-322 生产读数载体）
status: done
labels: []
parent: null
children: []
extra: {}
goal_ac: AC-903
---
## Contract

一次性的落地演练载体任务。唯一目的：让 `goal/GOAL-903` 经历一次**含追平的机械 fan-in 落地**，使 AC-322 判据在真实 store 上取到 exit 0。⛔ 无代码改动；本任务的 delta 只有本文件。`status: ready` 是刻意的：只有 ready→done 才会让 fan-in 的 flip 产出一个带 `tasks: 翻 T-903-drill done（driver 机械 fan-in）` subject 的提交。

## Plan

本记录不再执行任何步骤——落地由 `runMechanicalFanIn --merge-target goal/GOAL-903` 产生。

## Touches

- tasks/T-903-drill.md

## Acceptance Criteria

- [x] AC1（演练落地发生）：`git log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）"` 非空。
- [x] AC2（落地含追平）：追平 merge 之前记下的 `git rev-parse develop` 是翻 done 提交的祖先。

## Definition of Done

- [x] 演练落地已发生：追平 merge 提交留在落地历史里，flip 提交 subject 为 `tasks: 翻 T-903-drill done（driver 机械 fan-in）`。

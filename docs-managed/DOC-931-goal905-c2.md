---
id: DOC-931
title: goal 分支第二次演练 C-2
status: draft
kind: drill
---

## 演练记录

这是 GOAL-905 第二次演练 C 批的第 2 篇。本篇关注的是**落后 develop 的追平**：goal 分支
一旦在演练期间被推进若干提交，任务 worktree 的基点就会落后于 develop；此时 fan-in 先
merge develop 再 ff 回 goal 分支，看这份「先追平、后落地」的顺序会不会产生非快进。

判断这件事是否真的发生过，不看任何自报的心跳，只看两个外部可核的量：`git log` 里
merge 提交的先后顺序，以及 `git merge-base --is-ancestor` 的返回值。前者说明动作发生过，
后者说明结果确实是快进而不是强推。

### 本次演练要验证什么

- 任务分支在落后 develop 时仍能 merge 成功（无冲突，或冲突被语义解决而非跳过）；
- merge 之后 goal 分支与任务分支之间是祖先关系，ff 成立；
- 追平合入的别人的提交不计入本任务的 delta（所以 AC 用 `^develop ^goal/GOAL-905`
  的两点排除，而不是三点 diff）。

### 它只存在于 goal/GOAL-905

在并入 `develop` 之前，本篇只存在于 `goal/GOAL-905`：预览实例的 `/doc` 页能列出
DOC-931，生产实例列不出。这正是「预览自动装配」这条断言的可见面。

| 场景 | 期望行为 |
|---|---|
| 任务分支落后 develop N 个提交 | merge develop 后 ff 仍成立 |
| merge 引入他人提交 | 不计入本任务 delta |
| ff 非快进 | 按既有追平重试处理，并记下重试次数 |

## 备注

本篇的表格刻意只列三种场景，用来对照 A 批与 B 批各自的表格是否覆盖了同一条接线。

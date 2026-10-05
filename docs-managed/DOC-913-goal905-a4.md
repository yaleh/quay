---
id: DOC-913
title: goal 分支第二次演练 A-4
status: draft
kind: drill
---

## 演练记录

本文档是 GOAL-905（goal 分支第二次演练）A 批的第 4 篇，内容刻意无害。

### 本篇负责验证什么

**刷新。** 任务 worktree 是从 `goal/GOAL-905` 开出来的，开出来的那一刻它就是这个分支的
一个快照。演练期间 `goal/GOAL-905` 会因别的批次落地而前进，`develop` 也会前进。本篇要
观测的是：刷新（`git merge develop` 进 worktree、以及预览实例重新读盘）之后，worktree
里看到的世界是否跟上了——而不是停留在开出来的那一刻。

### 刷新的三处

| 刷新的对象 | 触发方式 | 失败的样子 |
|---|---|---|
| 任务 worktree 的 develop 基线 | fan-in 前的 `git merge develop` | 落地把 goal 分支带回旧基线 |
| 预览实例的文档列表 | 重新读 `docs-managed/` | 新文档列不出来 |
| 任务体自身的状态 | `task_write` 提交 | 勾选停留在盘上未提交 |

第三行最容易漏：勾选是写进 `tasks/<id>.md` 的，如果那次写入没有被提交，fan-in 的
ac-precheck 读到的仍是一条没打勾的 AC，整轮 fan-in 就白跑了。

### 记录内容

演练结束时应能读到：worktree 刷新前后 `git log --oneline -1` 的差异、预览实例在一次
刷新前后 `/doc` 页条目数的变化、以及本任务的勾选提交是否出现在 `goal/GOAL-905` 的历史里。

### 可见性边界

本文档只存在于 `goal/GOAL-905` 分支上。并入 `develop` 之前，预览实例的 `/doc` 页能列出
`DOC-913`，生产实例列不出；这正是刷新观测的一半——刷新生效，预览才会列出它。

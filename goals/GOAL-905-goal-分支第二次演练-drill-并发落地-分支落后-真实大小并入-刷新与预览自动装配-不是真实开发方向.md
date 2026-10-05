---
id: GOAL-905
title: goal 分支第二次演练（drill）——并发落地、分支落后、真实大小并入、刷新与预览自动装配；不是真实开发方向
status: active
kind: goal
origin: 人 2026-10-05「补上没覆盖的路径」：对 GOAL-028 做第二次演练（多任务并发落同一 goal 分支、goal 分支落后
  develop、真实大小的并入、修复后的刷新与预览自动装配）；判据能在生产实例上判假（落笔当轮读数见各 AC 的验证）。
activatedAt: 2026-10-05T14:27:57.193Z
statusLog:
  - at: 2026-10-05T14:27:57.193Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-05 授权第二次合并演练：三条 AC 已激活、三个承接任务已立并停放；激活 GOAL 即从 develop tip 懒建
      goal/GOAL-905
branch: true
---
## 背景

**这是第二次演练（drill），不是真实开发方向。** 第一次演练（GOAL-904）只覆盖了「单个任务、doc-only、手工补了两处」的路径，并在过程中挖出 5 个缺陷（均已修）。本次演练补第一次没覆盖的路径，且**不做任何手工干预**——需要手工才能继续的地方本身就是发现：
1. **多个任务并发落到同一个 goal 分支**：三个 Touches 互不相交的任务同时被派发，竞争同一把 `fan-in.goal-GOAL-905.lock`，先落地者推进 goal tip，后落地者的 ff 非快进 ⇒ 走再追平重试。
2. **goal 分支落后 develop**：goal 分支在激活时从 develop tip 分出，任务在 develop 前进若干提交之后才派发，追平步骤要真的合入 develop 的新提交。
3. **真实大小的并入**：三个任务各加 8 篇文档（共 24 个文件、约一千行），并入走完整的合并、typecheck、scoped 门、全量 suite、ff。
4. **修复后的刷新**：每次落地后 goal-driver 把判据 worktree 刷新到新 tip（读数 `refreshed`，此前只读到过 `current`）。
5. **预览自动装配依赖**：`quay goal preview GOAL-905 start` 在判据 worktree 上直接起来，不手工链接 `node_modules`。

承载内容刻意无害：三批托管文档 `DOC-910…917`、`DOC-920…927`、`DOC-930…937`（`docs-managed/`，kind: drill）。它们只存在于 `goal/GOAL-905` 上——预览实例的 `/doc` 页列得出，生产实例在并入前列不出。

## 范围与非目标

- 范围：三个任务（`gap-goal905-drill-docs-a`、`-b`、`-c`）、三条 live-probe AC（AC-905/906/907，各自检查一批的首篇）。
- 非目标：不改任何产品代码；不改 GOAL-028 的任何判据；演练文档并入后保留，作为演练记录，清理另立任务。

## 退出条件

提供本 workspace 的 quay serve 实例，其 `/doc` 页同时列出三批演练文档的首篇 DOC-910、DOC-920、DOC-930——并入前由预览实例满足，并入后由生产实例满足（三条 AC 的判据对两种实例同形：读该 workspace root 下登记在册的 serve）。

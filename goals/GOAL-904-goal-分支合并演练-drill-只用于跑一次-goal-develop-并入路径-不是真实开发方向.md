---
id: GOAL-904
title: goal 分支合并演练（drill）——只用于跑一次 goal→develop 并入路径，不是真实开发方向
status: achieved
kind: goal
origin: 人 2026-10-03「第二步先做合并演练再做试点」：对 GOAL-028 跑一遍 goal
  分支完整路径（演练，非真实开发方向）；判据能在生产实例上判假（落笔当轮读数：生产 /doc 无 DOC-904 ⇒ exit 1）
activatedAt: 2026-10-03T15:49:36.349Z
statusLog:
  - at: 2026-10-03T15:49:36.349Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-03 裁定做 goal 分支合并演练；AC-904 已激活，承接任务已立并停放；激活 GOAL 即从 develop tip
      懒建 goal/GOAL-904
  - at: 2026-10-03T17:50:56.622Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
branch: true
---
## 背景

**这是一次演练（drill），不是真实开发方向。** 目的：对 GOAL-028（goal 独立分支）跑一遍完整路径，使它的 AC-321…325/327/328 取到真实读数——任务经 goal 分支落地、预览实例上试用并通过 live-probe 判据、人触发并入、worker-driver 以 `--no-ff` 合并提交并入 develop。承接前几次演练（GOAL-901/902/903）：那几次发生在派发接线落地之前，其任务直落了 develop，不是 goal 分支落地（见 SPEC-goal-branch-2026-10-03 §7「判据的拓扑前提」）。

演练内容刻意无害：一份说明本次演练的托管文档 `docs-managed/DOC-904-goal-branch-merge-drill-record.md`。它只存在于 `goal/GOAL-904` 上——预览实例的 `/doc` 页能列出它，生产实例列不出；并入 develop 后生产也列得出。这就是「并入前可试用」的可观察形态。

## 范围与非目标

- 范围：一条任务（`gap-goal904-merge-drill-record-doc`）、一条 live-probe AC（AC-904）。
- 非目标：不改任何产品代码；不改 GOAL-028 的任何判据；演练文档并入后保留，作为这次演练的记录，不在本 goal 内清理。

## 退出条件

提供本 workspace 的 quay serve 实例，其 `/doc` 页列出演练记录文档 DOC-904——在并入前由预览实例满足，并入后由生产实例满足（AC-904 的判据对两种实例同形：读该 workspace root 下登记在册的 serve）。
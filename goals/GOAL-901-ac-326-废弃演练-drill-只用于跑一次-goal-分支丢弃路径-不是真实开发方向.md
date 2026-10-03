---
id: GOAL-901
title: AC-326 废弃演练（drill）：只用于跑一次 goal 分支丢弃路径，⛔ 不是真实开发方向
status: active
kind: goal
origin: GOAL-028 退出条件② 废弃演练（AC-326 生产读数）——一次性演练记录，⛔ 不是真实开发方向。
activatedAt: 2026-10-03T10:36:18.524Z
statusLog:
  - at: 2026-10-03T10:36:18.524Z
    from: draft
    to: active
    actor: ac326-drill
    reason: AC-326 废弃演练：从 develop tip 懒建 goal/GOAL-901，随即记下 tip 并进入 retired 步骤
branch: true
---
背景：AC-326 判据要求 store 中至少存在一个 branch:true 且 status∈{retired,superseded} 的 goal，其 goal/<id> 分支已删除、tip SHA 留在 statusLog。本记录是执行该废弃演练的一次性载体。范围：只经 quay goal write --store 走 draft→active→retired 三步，跑通 goal/GOAL-901 的懒建与丢弃。非目标：⛔ 不承载任何真实开发方向、⛔ 不并入 develop、⛔ 不新增任何代码路径。退出条件：GOAL-901 为 retired、分支不存在、tip SHA 记入 statusLog。
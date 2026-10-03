---
id: GOAL-902
title: AC-322 追平落地演练（drill）：只用于跑一次 goal 分支的追平落地，⛔ 不是真实开发方向
status: draft
kind: goal
origin: GOAL-028 退出条件① 的 AC-322 生产读数（drill）——一次性演练记录，⛔ 不是真实开发方向。
branch: true
---
背景：AC-322 判据要求至少一个 branch:true 的 goal 有 ≥1 次「落地」，且该落地包含其追平时刻的 develop tip；机制（worker-fan-in.ts step 2b）已落地并单测，但从未在生产上跑过。范围：只经 store CLI 走 draft→active，从 develop tip 懒建 goal/GOAL-902，一次含追平的机械 fan-in 落地后 ff 并入 develop 并删除分支。非目标：⛔ 不承载任何真实开发方向、⛔ 不新增代码路径。退出条件：GOAL-902 名下 AC-902 的演练任务落地、判据 AC-322 读 exit 0、无 goal/* 残留分支。
---
id: GOAL-006
title: 活跃 AC 能否留空 criterion：SPEC-0809 §3（空⇒fail-closed 诚实）与 AC-180（活跃 AC 必有可跑判据）正面冲突
status: superseded
kind: goal
origin: >-
  【已判定为假冲突，2026-09-06，撤回而非请人裁定】


  原问题：13 条活跃 AC（AC-143..155）criterion 字段空缺、自称「语义判据」并引 SPEC-0809 §3
  为据；AC-180（draft）主张不存在无判据的活跃 AC。本条曾把两者报为「正面冲突」请人裁决。


  【为什么撤回】去读 SPEC-goal-store-2026-08-09.md §3 原文，它并没有允许留空，说的是相反的：
    「fail-closed：criterion 未设 ⇒ 判红。照抄 makeDocumentContractGate 的原则（an unenforceable document must never silently PASS）。这条是本规格的核心价值之一：AC28 当前不可机械判定，迁移后会立刻 fail-closed 报红——那是对的，它今天被散文盖住了。」
  ⇒ §3 与 AC-180 是【同一个立场】：未设判据必须报红，且报红是【逼人去补判据的压力】，不是可以停留的状态。没有两个立场要裁决。


  【误读的真实来源】不在 meta-driver，在 AC 正文：26 条 AC 记录各带一行同样的样板——断章取义地引用
  SPEC-0809 §3 的 fail-closed 原则（「语义判据、无可跑 shell 判据；gate fail-closed（红）是诚实状态」）
  来为自己的判据字段空缺背书。probe 如实转述了这个说法，是记录在骗读者，不是 probe 在骗人。


  【人 2026-09-06 的判断，独立得出同一结论】「对于生命周期较短的 task 来说，空⇒fail-closed 诚实是可行的；而对于 goal 的
  AC 来说，禁止活跃 AC 无判据是必要的。」实测 AC-143 等均为 kind:criterion、goal:GOAL-002 的 goal-store
  AC（与 AC-180 同一对象），⇒ 按该原则直接落在「必须有判据」一侧。


  【后继】工作已立案（补判据 + 删除误引样板），非裁定事项。本条 superseded，⛔
  保留不删——它是「机制把假冲突升级给人」的第一个实例，是校准升级判据的依据。
---

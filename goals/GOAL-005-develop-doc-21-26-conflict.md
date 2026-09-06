---
id: GOAL-005
title: 语义兜底「取 develop 永远有效 ⇒ 必成功」与「⛔ 不丢 doc 提交」矛盾：21/26 停在 conflict 且升级未接线
status: achieved
kind: goal
origin: >-
  【已裁定 2026-09-06】人：「merge 冲突时可以损失 author 分支的变更」⇒ 选项 A。


  【已落地】driver-filters.ts takeDevelopDiscardingDoc（commit
  55805b257）：结构冲突（add/add、delete/modify、rename——`-X theirs` 消解不了的那些）⇒ 硬取 develop
  ⇒ 语义同步第一次真正「必成功、永不卡死」。此前实测 26 次进入兜底、21 次卡死在 conflict，且 return false 之后无任何升级接线。


  【允许丢失 ≠ 静默丢失】被丢弃的 doc 侧提交逐条枚举进事件（resolution=discarded-doc-commits +
  discardedCount + discarded[]）；semantic-conflict 事件照写 ⇒ 事后可知这次走的是丢弃路径，而非普通合并。


  【已知代价，如实记录】doc 侧更前进的任务状态（doc=done vs develop=ready）也在丢弃之列 ⇒
  该任务可能被重新派发。这是本裁定的直接后果，不是缺陷。


  【判据】plugin/test/driver-filters.test.mjs 的 AC1：真 modify/delete 冲突下
  propagateDocBranchToDevelop 返回 true、两 ref 一致、被丢弃提交逐条留痕。45/45 绿。
---

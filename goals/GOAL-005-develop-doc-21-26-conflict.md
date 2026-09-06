---
id: GOAL-005
title: 语义兜底「取 develop 永远有效 ⇒ 必成功」与「⛔ 不丢 doc 提交」矛盾：21/26 停在 conflict 且升级未接线
status: draft
kind: goal
origin: >-
  【要裁定什么】git merge -X theirs 撞结构冲突（add/add、delete/modify、rename）时，「取
  develop」应以何种机械形式落地？

  【选项与代价】A: 结构冲突时允许丢 doc 提交（reset/checkout 到 develop）——成本：违反 AC4『doc-only
  提交都进历史』，丢尚未 fan-in 的 doc 工作；B: 强制树=develop 但保留双方提交在历史（merge + checkout develop
  -- . + commit）——成本：实现复杂、doc 变更静默消失但提交留存；C: 接线原设计宣称的 Claude Code 语义合并（subagent
  接手 code/docs 冲突）——成本：LLM 进同步关键路径、每次冲突花一次 subagent，但保住『不丢提交』

  【实测依据】syncHealth.semanticResolved = 2（meta-driver 机械采集于 2026-09-06T12:21:48Z）

  【为什么不能机械决定】syncHealth.semanticResolved=2 与 focus 所述『26 进 5 resolved 21
  conflict』同向（conflict 不进 syncHealth 聚合面——meta-driver.ts 只数 4
  种终结态事件，读数本身盲于此失败态）；读码确认 semanticSyncDocToDevelop 的 -X theirs 只消解内容冲突、结构冲突必
  throw，返回 false 后无任何调用者接线 Claude Code 升级——原任务
  gap-doc-develop-sync-semantic-conflict-resolution 已 done 且 AC3『升级 Claude
  Code』实为未接线。取舍『丢 doc 提交』vs『接 LLM』是方向裁定，机器不能替人定

  【怎么关闭】认可某个选项 ⇒ goal-store write <id> --status active；否决 ⇒ 保持 draft 或标
  superseded。
---

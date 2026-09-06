---
id: GOAL-004
title: author↔develop 同步的 ff-only + 两个写面是否改方向
status: draft
kind: goal
origin: >-
  【要裁定什么】ff-only 传播 + 写面留 author 的同步架构是否要改方向（状态直落 develop / 放宽为语义合并主路径 / 维持现状）？

  【选项与代价】①维持现状（写面 author + ff-only + 语义兜底）：成本=已测出
  notFf=30、ffError=44、semanticResolved=1，两写面持续分叉且语义兜底几乎不触发，机械同步在裸奔；②写面反转（状态直落
  develop、author 纯读）：成本=改 driver-filters.ts 两处翻转点 + 迁移现有 author 检出，但消除双写面造成的
  notFf 分叉；③ff-only 放宽为语义合并主路径：成本=放弃确定性，引入 LLM 合并成本与不可控风险

  【实测依据】syncHealth.notFf = 30（meta-driver 机械采集于 2026-09-06T11:31:24Z）

  【为什么不能机械决定】「同步方向要不要改」是『我们要什么』的方向裁定，机器不得自决——notFf=30 是测量事实，但从哪个方向修（反转写面 vs 维持
  vs 放宽）是人来定的架构取舍

  【怎么关闭】认可某个选项 ⇒ goal-store write <id> --status active；否决 ⇒ 保持 draft 或标
  superseded。
---

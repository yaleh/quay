---
id: GOAL-004
title: author↔develop 同步的 ff-only + 两个写面是否改方向
status: draft
kind: goal
origin: |-
  【要裁定什么】ff-only 传播 + 写面留 author 的同步架构是否要改方向（状态直落 develop / 放宽为语义合并主路径 / 维持现状）？

  【⚠️ 证据已订正 2026-09-06】本条 origin 初版由 meta-driver 语义半生成，经读码核实有三处错误，已重写。原文「notFf=30、ffError=44、semanticResolved=1，两写面持续分叉且语义兜底几乎不触发，机械同步在裸奔」不成立，勿据此裁定。

  【实测（全历史 686 事件，2026-08-31→09-06，逐条读码核实）】
  - 两个方向的保护不对称：develop→author（syncDevelopToDoc）只有机械 ff-only，**按设计没有兜底**（driver-filters.ts 注释明写兜底归 author→develop 路径）；author→develop（propagateDocBranchToDevelop）ff 失败才升级 semanticSyncDocToDevelop。
  - author→develop 方向健康：237 次中 216 次机械 ff 成功 + 5 次语义兜底解决 = 221 成功 / 21 失败（93%）。
  - develop→author 方向：synced 32 / not-ff 183 / error 22。
  - 语义兜底 26 次进入：5 次 resolved、21 次停在 conflict（align-failed=0、ff-failed=0 ⇒ 全部卡在冲突这一步）。
  - ff-error 全部 44 条 phase=merge：ref 层面可快进但 `git merge --ff-only` 抛错（共享检出工作树脏是最可能成因，我自己也制造过若干）。
  - 分叉不是瞬态：27 段连续 not-ff，最长 32 次连续跨 29.4 小时（09-03→09-04），另有 13h / 12h / 3.8h / 2h 各一段。

  【三处订正】
  ① 「语义兜底几乎不触发」错：它不在 not-ff 那条路径上，不是该触发而没触发。
  ② 「notFf 高 ⇒ 持续分叉」不可推出：not-ff 的判据是 `rev-list --count develop..author > 0`，且**分叉检查排在落后检查之前** ⇒ author 只要有一个 develop 未含的提交就报 not-ff，**哪怕 author 一点也不落后、根本无物可拉**。而这正是每次任务状态翻转提交后的常态。
  ③ 该数字**结构上不可解读**：not-ff 事件只记 {ts,event,phase,branch}，不记 ahead/behind 计数 ⇒ 无法从载体区分「只领先（良性）」与「既领先又落后（真分叉）」。

  【选项与代价（按订正后的证据）】
  ①维持现状：真实代价不是「notFf 高」，而是 (a) develop→author 方向无兜底，(b) 21 次语义冲突未解决，(c) 44 次 merge 失败原因被丢弃（stdio:"ignore"）不可归因。
  ②写面反转（状态直落 develop、author 纯读）：消除双写面 ⇒ not-ff 这一类从源头消失；代价=改 driver-filters.ts 两处翻转点 + 迁移现有 author 检出。人 2026-08-31 曾反向裁定过（从直落 develop 改回写面 author），改回需要推翻那条。
  ③ff-only 放宽为语义合并主路径：放弃确定性；且现有语义兜底 26 次里 21 次卡在冲突，先要解决它为何解不了冲突。

  【实测依据】syncHealth.notFf = 30（meta-driver 机械采集）；全历史与方向拆分由本次读码+载体分析补全。

  【为什么不能机械决定】「同步方向要不要改」是『我们要什么』的架构取舍——测量能说清现状代价，说不出该往哪走；且选项②要推翻人 2026-08-31 的既有裁定。

  【怎么关闭】认可某个选项 ⇒ goal-store write GOAL-004 --status active；否决 ⇒ 保持 draft 或标 superseded。
---

---
id: GOAL-004
title: author↔develop 同步的 ff-only + 两个写面是否改方向
status: superseded
kind: goal
origin: |-
  【已撤回 2026-09-06 — 本条不该存在】人：「这是可解的。meta driver 要么找到个现有机制解决这个问题，要么创建一个机制解决这个问题。不应交给我判断。」

  ⊢ 这条 GOAL 是 meta-driver（与我）的一次**误分流**：把三个【可解的机制缺陷】包装成一个「要不要改方向」的决策交给人。判据是：如果问题能由既有机制的修复解决，它就是工作，不是裁定。这三条都能。

  【三条已全部落地，commit 55805b257】
  ① 语义兜底 21/26 卡在 conflict ⇒ takeDevelopDiscardingDoc：结构冲突硬取 develop ⇒ 必成功（依据 GOAL-005 的裁定）。
  ② ff-error 44 条全 phase=merge 而原因被 stdio:"ignore" 丢弃 ⇒ 捕获 stderr 写入 detail ⇒ 可归因。
  ③ not-ff 不记 ahead/behind ⇒ 该读数结构上不可解读（曾让 183 条 not-ff 被误读为「持续分叉」）⇒ 现记 ahead/behind/benign，benign 由 behind 派生。

  【顺带修好的两个读数缺陷（meta-driver 自己发现）】
  - collectSyncHealth 漏数 semantic-conflict ⇒ 对占主导的失败态全盲：改前读数 semanticResolved=2 像「兜底几乎不跑」，改后 begin 23 / resolved 2 / conflict 21 才是真相。
  - draft 记录被当成承诺 ⇒ 提案被报成 pass-but-unflipped。

  【本条的处置】superseded：方向问题不成立（矛盾已由 GOAL-005 的裁定消解），工作已落地。
  ⛔ 保留本记录而非删除，是为了留下「误分流」这个实例本身——它是判据校准的依据。
superseded-by:
  - GOAL-005
---

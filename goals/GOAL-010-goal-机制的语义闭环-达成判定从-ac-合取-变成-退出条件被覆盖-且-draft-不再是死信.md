---
id: GOAL-010
title: goal 机制的语义闭环 —— 达成判定从「AC 合取」变成「退出条件被覆盖」，且 draft 不再是死信
status: achieved
kind: goal
origin: >-
  人 2026-09-09 三条裁定：①晋升应当是语义的；放弃（retire）不交给 goal-driver——它若期望退役某条 AC，应置为
  needs-human 并说明理由，交人判断。②needs-human 阻塞 GOAL 达成。③六条 AC 分开不合并。（本裁定解除
  SPEC-goal-mechanism-2026-09-06 裁定 3 中「暂不做自动晋升」的「暂」，但保留其 §6.1
  中「放弃是判断不是计算」的对称约束。）


  立条的实测依据（2026-09-09 采集，非主张）：①GOAL-001 于 2026-09-07T12:29:05Z 被机械 flip
  achieved，当轮名下 10 achieved + 6 draft + 1 retired；那 6
  条（AC-180/182/183/184/186/187）从创建到 2026-09-09 04:24–04:48 退役，全程未被激活、未参与判定。②过去
  72h 内父 GOAL 已 active 时动态新增 AC 共 10 条，5 条进判定、5 条卡 draft，分界只是「有没有人恰好去激活」。③9 条
  GOAL 中 5 条 body 为空（004/005/006/007/008），其中 005/007/008 已 achieved ⇒
  业务目标从未写下就判达成；body 必填的 gap-goal-record-completeness-undefined 于 2026-09-08
  落地且只对 create 生效。④meta-driver 6169 轮从未成功写过一条 AC，其 GOAL 提案路径实测 exit=1（requires a
  body of ≥40）。⑤goal 环于 2026-09-08T19:55:51Z 起空转 6h20m（goalCount=0）。


  规格出处：orchestration/SPEC-goal-mechanism-2026-09-06.md（§3.2 draft 状态、§4.1
  I1′、§6.1 职责边界）。



  【激活】2026-09-09 人单次授权激活。裁定：①晋升应当是语义的；放弃(retire)不交给 goal-driver，它若期望退役某条 AC 应置
  needs-human 并说明理由交人判断 ②needs-human 阻塞 GOAL 达成 ③六条 AC 分开不合并。


  【重启 2026-09-09】人授权按对照实验 B 形态重启：先激活 6 条 draft（AC-210/211/212/213/215/216）再翻本
  GOAL 回 active，使 flip 那一刻在域集合已含 6 条红 AC。事故经过与结构根因见 AC-212 的 origin。
statusLog:
  - at: 2026-09-09T17:41:39.138Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---

## 背景

GOAL 的达成判定至今是**纯语法的合取**：`goal-driver.ts:283-288` 的 `goalAchievedFromRecords`
判「所有在域 AC 都 achieved」即 flip GOAL 为 achieved。**没有任何环节问过「这组 AC 若全绿，
是否等于该 GOAL body 里写下的退出条件达成」。** 三处实测暴露了这个缺口的代价：

① **draft 是死信**：GOAL-001 于 2026-09-07T12:29:05Z 被机械 flip achieved，当轮名下
10 achieved + **6 draft** + 1 retired。这 6 条（AC-180/182/183/184/186/187）从 2026-09-06
创建到 2026-09-09 04:24–04:48 被退役，**全程未被激活、未参与过任何达成判定**。draft AC
三头不占：不被 flip（`:633` 只翻 active）、不计缺口（`:345` 只数 active）、也不挡达成。

② **执行中新增的 AC 一半掉进死信**：过去 72 小时内在父 GOAL 已 active 时动态新增 AC 共 10 条
（AC-182/183/184/185/186/187、AC-192/193/194、AC-200），其中 5 条被激活并计入判定，
另 5 条卡在 draft 直到 GOAL 关闭——分界不是内容质量，只是「有没有人恰好去激活它」。

③ **业务目标可以从未被写下就判达成**：9 条 GOAL 中 5 条 body 为空
（GOAL-004/005/006/007/008），其中 **GOAL-005/007/008 已 achieved**。对它们，
「业务目标是否达成」在机制里结构上无从判断。`body` 必填是 2026-09-08 才落地的
`gap-goal-record-completeness-undefined`，且**只对 create 生效**，存量五条未回填。

同期还有两个佐证：`meta-driver` 6169 轮（2026-09-06T14:25→2026-09-09T05:53）从未成功写过
一条 AC，其 GOAL 提案路径自完整性闸落地后实测 `exit=1`；goal 环于 2026-09-08T19:55:51Z
起空转 6 小时 20 分（`goalCount=0`），因为没有任何机制会在目标耗尽时补充方向。

## 范围与非目标

**范围**：
① **充分性闸**——I2 的 GOAL 层 flip 之前先判「body 的退出条件是否被当前 AC 集合覆盖」，
   不足则保持 active 并产出新 AC 提案；判不出必须取「未评估」这一独立值，⛔ 不与「覆盖」同形。
② **draft AC 分诊**——扩 G9 的对象集（从「active 且零任务的缺口 AC」扩到「active GOAL 名下的
   draft AC」），复用现有 spawn 通道，对每条 draft AC 出五态判决之一：
   `activate` / `re-anchor` / `retire` / `needs-human` / `hold`，逐条落痕。
③ **AC 的 `needs-human` 状态**——进词表、**计入在域、阻塞 GOAL 达成**（人 2026-09-09 裁定 2）。
④ **存量空 body 的 GOAL 回填退出条件**——①的输入前置，没有退出条件文本就无从判充分性。

**非目标（明确排除，各自应单独立项）**：
- **driver 自动【放弃】**：`retire` 仍归人（SPEC-goal-mechanism-2026-09-06 §6.1「放弃是判断
  不是计算」）。人 2026-09-09 裁定 1：driver 若期望退役某条 AC，**应把它置为 `needs-human`
  并说明理由，交人判断**——⛔ 不得自行翻 `retired`。
- **GOAL 记录的自动创建**（本轮只做 AC 层的分诊与充分性，GOAL 的立与激活仍归人）。
- **store-commit 记录写入者**（2026-09-09 实测：6 条 AC 的创建提交全是固定文案、无会话落款
  ⇒ 立条者不可追溯）——属提交面（GOAL-008 领域），另立 gap 任务。
- **`cap=3` / `stale=7d` 的数值重估**（GOAL-001 风险 4 已单列，跑满 30 天用真实分布再谈）。
- **GitHub provider 对 goal 的真映射**（沿用 GOAL-001 的非目标）。

## 退出条件

散文版：
1. 一条 draft AC 在 active GOAL 名下**不会无限期无人过问**——每条都会被分诊出一个判决并留痕，
   **且 `activate` 这一判决被 driver 实际执行**（draft→active 真的发生），而不是只写进读数里无人消费。
   ⛔ `retire` 不在此列，仍归人（见非目标与裁定 1）。
2. GOAL **不会在退出条件未被覆盖时自行关闭**；覆盖与否判不出时，取「未评估」而非放行。
3. 要人裁定的 AC 有一个**会挡住 GOAL 关闭**的承接态，而不是又一个惰性的 draft。
4. driver 永远不自行放弃一条 AC——它只能建议（置 `needs-human` 并说明理由）。
5. 每条非 superseded/retired 的 GOAL 的业务目标在记录里可读。

机器判据在本 GOAL 名下的 AC 记录里，**不在本节**（初始 6 条 `AC-208`…`AC-213`，
执行中按同一批退出条件补入 `AC-215`/`AC-216`/`AC-217`/`AC-219`/`AC-222`/`AC-223`）。

## 风险

1. **bootstrap**：本 GOAL 要建的正是「driver 语义驱动晋升」，而该机制此刻不存在
   ⇒ **本 GOAL 自身与其 AC 只能人工激活**（同 GOAL-001 风险 5 的形态）。
2. **充分性闸把 LLM 引入 GOAL 的关闭路径** ⇒ 引入不确定性与成本。对策：判不出 ⇒ 不 flip
   且报 `not-evaluated`（AC-213）；同时**保留人工强制关闭出口**（`goal write --status achieved`
   仍可用），否则语义半长期不可用会让所有 GOAL 永远关不掉。
3. **`needs-human` 计入在域会永久阻塞 GOAL** ⇒ 这是有意为之（裁定 2），但必须能被看见：
   I3 陈旧桶与 dashboard 需能报出「因 needs-human 而挂起」的 GOAL。
4. **分诊判决可能错**（把该激活的判成 hold、把该重锚的判成 retire 建议）⇒ 逐条落痕、可回溯，
   照 `fileProposals` 的「枚举不布尔」（硬规则 3）；且 `retire` 只作建议不作执行（裁定 1）
   把最不可逆的一态挡在人这一侧。
5. **判据自身的类别错误**：本 GOAL 的 6 条判据**只引用不会自行回退的量**——代码状态与
   append-only 载体里的历史事实，⛔ 不含进程存活/载体新鲜度/当前红绿。这条纪律来自
   2026-09-09 退役 AC-180/184/186 的理由：`achieved` 不可逆（`goal-driver.ts:183-187`
   全仓无反向翻转），活性判据一旦翻 achieved 就永久声称一件已不成立的事。

## 与其他 goal 的关系

`GOAL-001`（goal 机制启用与改造）按其自身 body 的 5 条退出条件已达成（逐条对应
`AC-170`…`AC-179`，全部 achieved），⛔ 本 GOAL **不是**它的重启：本 GOAL 处理的是
「把 goal 机制用起来之后才暴露的语义缺口」，属 GOAL-001 body 里未声明的新范围。
`GOAL-009`（交付面端到端自证）与本 GOAL 同时 active，二者不共享 AC，受 I1′ 硬上限约束（cap=3）。
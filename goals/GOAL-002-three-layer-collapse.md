---
id: GOAL-002
title: 三层塌缩 —— 会话退役，机制承接
status: active
kind: goal
origin: |
  人 2026-08-25 逐字裁定「现在正式切换阶段（晋升面机械化 → 三层塌缩）」；
  人 2026-08-23 方向「质量把关→driver，其它定期操作→driver，语义撰写/人机接口→subagent，
  彻底取消 outer 会话（inner 已由 worker-driver 代替）」，来源②「创建/更新下一阶段计划，
  以退役 outer 和 inner 为目标，列入上述计划，并设置相应的 AC」。
activatedAt: 2026-09-06
labels: [current-phase, session-retirement, mechanism-takeover]
---

## 背景

三层互看（outer / inner / manager）是会话时代的产物：outer 的 A/B 段大量条目只因 inner 是
「会话」才存在（会话可静默跳过一步，故需账本类自查；会话需 tmux 卫生，故有硬约束）。
人 2026-08-23 定下方向：质量把关转 driver、其它定期操作转 driver、语义/人机接口转 subagent、
彻底取消 outer 会话。manager 2026-08-23 机械计数证实这不是搬迁而是【删除】工作：outer A段 9 条
（A4/A7/A8/A12/A13/A16/A17/A19/A20）+ B7 只因 inner 是会话才存在；硬约束 6/16 是 tmux/会话卫生，
会话没了即消失；inner 核「账本·机制是否真被调用」5 条只因会话可静默跳过一步。驱动进程的循环
不可能静默跳过一步——要么执行要么死，且死可由 supervisor alive=0 直接看见。本 GOAL 把三层
塌缩为「driver 机械面 + manager 语义面 + 人兜底」。

## 范围与非目标

范围：外层纯机械 A/B 段收进 driver（AC143）；质量把关按四种形状分开驱动化（AC144）；
语义面 subagent 化由 manager 后台驱动（AC145）；人机接口显式承接者（AC146）；manager 活性由
不依赖 manager 的通道兜底（AC147）；inner 执行核逐条归属（AC148）；会话真正退役、不留双真相源、
产能不塌（AC149）；driver 分层抽象五条（AC151–AC155）；promotion-driver 资源感知与控制面对齐
（AC150，本阶段交付物自身的功能缺口）。

非目标：取消 manager 会话本身（人方案里 manager 保留为语义驱动方，最上层仍是 LLM 会话、由人
兜底——A16「最上层由人兜底」的既有裁定，本阶段不改）；driver 并发/选择策略调优；产品功能推进；
方法论层架构 SPEC 的 B1/B2/B3/B5（归后续独立阶段；B0 已并入 AC149 交叉引用）。

## 退出条件

散文版：outer / inner 会话停止，其 cron 锚、tick-log、执行核文档按 AC135/AC141/B9 同一套写法标
退役；会话停后连续 ≥24h 任务持续 land（develop 上有新 fan-in 合并提交）且速率不低于停机前同长度
窗口；不存在任何「两个执行者做同一件事」的路径；`fast-mode-tick-core.md` 的 A1–A26 + B1–B5 每条
都有归属（driver 承接 / 随会话消失 / 保留且点名执行者）。机器判据在本 GOAL 的 13 条 AC 记录
（AC143–AC155）里，**不在本节**。

## 风险

1. 一次性退役十几条文档会批量制造「文档仍写每轮必跑」的漂移（AC149-1 取假，正是 B9 漂移形态）。
2. LLM-worker spawn 链在立条时 13/13 全败（fix-worker 10/10 + selector 3/3），而本阶段每条 AC
   都要起 LLM worker——地基未修则把未诊断缺陷复制到全系统（切换判据已加 AC142 前置）。
3. 取消两层后语义工作停摆无人察觉（最上层仍是 LLM 会话），需 AC147 的独立兜底通道。
4. 「两个真相源」若不清干净（AC135/AC141 的教训），驱动化后同一职责双路径并存。

## 与其他 goal 的关系

本 GOAL 与 GOAL-001（goal 机制启用）是「载体与被载」关系：本 GOAL 的 AC 是 GOAL-001 要求的
迁移对象（G2），其达成让 goal-store 首次有真实数据。本 GOAL 落盘后 GOAL-001 与 GOAL-002
同时 active——在旧 I1（至多一条 active）下非法，是 I1′ 多 active 的第一个真实载体。
GOAL-003（插件面收敛）是【下一阶段】，与本 GOAL 无依赖关系、可并行可后置，切换时机由人定，
迁入时 status=draft。

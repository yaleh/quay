---
id: gap-ownership-active-limited-proposal-mode
title: "ownership-active investigation loop: limited-proposal mode — one new
  call site that may create exactly one draft Goal (never activates), gated by
  the phase A+B entry bar (phase C of end-to-end architecture self-bootstrap)"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-architecture-evidence-store-and-decision-memory
---
**type:** execution

本任务是「端到端架构自举实验」(用户 2026-10-11 批准推动)的阶段 C——目前仍然缺失的那一步:`ownership-active-investigation-loop.mjs` 结构上永远只写 shadow carrier,从不创建真实 Goal/task(`plugin/test/ownership-active-loop.test.mjs` 有断言钉死这条红线)；`docs/analysis/ownership-active-replay.md` §6 已明确写出"限制提案模式"的四个准入条件,但从未落地。本任务落地它,且只落地到"产出一个 `draft` 状态的 Goal 交人审批"为止——**绝不自行把 Goal 转 active**,那永远是人的决定(同 GOAL-030~036 既有惯例:origin 字段必须引用人的裁定)。

依赖 `gap-architecture-evidence-store-and-decision-memory`(通过 `depends_on` 字段声明,非 prose 前置——该任务提供决策记忆 `isKnownExemption`、量化读数 `computeRunMetrics` 与新载体 `.quay/architecture-evidence-store.jsonl`,本任务的准入判据直接消费它们,不重新实现)。

## Proposal

新增一个**独立于** `ownership-active-loop.mjs` 的调用点 `docs/analysis/ownership-active-limited-proposal.mjs`,只做两件事:(1) 判断一条 carrier 记录是否满足准入条件;(2) 若满足,写**恰好一个** `status:"draft"` 的 Goal(不激活)。它读 carrier、读决策记忆,但不改写 `ownership-active-loop.mjs` 的终态逻辑——那个文件继续保持"只写 shadow carrier"的结构性质不变。

准入条件(逐字落地 `ownership-active-replay.md` §6 已写的四条,不重新发明):
1. `concern_kind === "package-cycle"`(目前唯一有可计算、可证伪 delta 的类型——其它 kind 继续停留在 shadow,不进入本机制)。
2. 该记录的 delta 由 ArchGuard `slice-delta` 原语**计算**得出(非模型自述),且负对照已证伪(`provenanceConsistency === "match"`)。
3. 决策记忆(`isKnownExemption`)判定为"非已知豁免/非已知缺陷"——命中 `exempted` 或 `known-not-yet-filed` 均不得进入本机制(前者已被人否决,后者是"已知但该走别的立案路径",都不该由本机制重新包装成一个新 Goal)。
4. 连续 **N=3** 次生产 live run(非回放)在同一 `concern_kind=package-cycle` 候选上产出一致的、可计算的 delta(run-streak)——防止用一次性波动触发提案。

## Plan

1. `docs/analysis/ownership-active-limited-proposal.mjs`:
   - `evaluateEntryBar(carrierRecords)`——纯函数,输入是 `.quay/architecture-evidence-store.jsonl` 里同一候选的记录序列,输出 `{eligible: boolean, reason: string, matchedConditions: string[]}`。四个条件任一不满足,`eligible:false` 且 `reason` 必须具体指出哪一条没过(不是笼统的 "not eligible")。
   - `proposeDraftGoal(eligibleRecord, existingGoalIds)`——仅在 `evaluateEntryBar` 返回 `eligible:true` 时调用;动态计算下一个开放的 `GOAL-0NN` 编号(从 `goal_list` 实时读取当前最大编号 +1,**不硬编码任何具体编号**——集成当天读到的编号与写入时刻可能不同,避免竟态要求重新读一次再比较);经 `goal_write` 写入 `status:"draft"`(⛔ 不是 `active`),body 含:引用的证据链(carrier 记录的 evidence id 列表)、ArchGuard 计算的预测 delta、可逆性评估(该候选是否可以像 GOAL-030~036 一样整分支丢弃)、以及一行"本 Goal 为自动投研机制产出的候选,须人工审批后才能从 draft 转 active,本机制不执行该转换"。返回创建的 Goal id。
   - **结构红线**:本文件不得出现任何把 Goal/Task 转为 `active`/`ready`/`done` 的调用(不 import `lifecycle_promote`/不写 `status:"active"` 字面量)——这是本任务与 `ownership-active-loop.mjs` 共享的同一条"自动机制不执行高风险操作"红线的下一个实例。
2. **准入判据回归**:构造四类反例(kind≠package-cycle;delta 未计算/`provenanceConsistency≠match`;命中决策记忆;run-streak<3),每一类都必须单独触发 `eligible:false` 且 `reason` 指向对应条件——不是笼统拒绝。
3. **编号正确性**:用一个 stub 的 `existingGoalIds` 集合(含 GOAL-030..036)验证选出 037;再用含 037 的 stub 集合验证选出 038——证明是动态计算,不是硬编码。
4. **生产 dry run(诚实的,不作弊)**:对当前 develop 尖端跑 `evaluateEntryBar`(消费 `gap-architecture-evidence-store-and-decision-memory` 已经产出的真实生产记录,不编造)。若不满足 run-streak(大概率,因为该任务目前只是刚起步),诚实记录"未满足,还差 N 轮"到 `docs/analysis/architecture-evidence-store-limited-proposal-report.md`,**不强行拼出一个候选来满足 DoD**——AC5 允许这个结果作为合法终态。若恰好满足,走步骤 5。
5. **若且仅若 dry run 判定 eligible:true**:调用 `proposeDraftGoal` 产出恰好一个 draft Goal,把完整内容(Goal 全文、预测 delta、可逆性评估)写入上述报告文件,供人工审阅——本任务到此为止,不做任何后续动作。

## Touches

- docs/analysis/ownership-active-limited-proposal.mjs (new)
- docs/analysis/architecture-evidence-store-limited-proposal-report.md (new)
- plugin/test/ownership-active-limited-proposal.test.mjs (new)
- tasks/gap-ownership-active-limited-proposal-mode.md

## AC

- [x] AC1 四类准入反例逐一拒绝且理由具体:构造 kind≠package-cycle、delta 未计算/provenanceConsistency≠match、命中决策记忆(exempted 或 known-not-yet-filed)、run-streak<3 四个独立反例,每个 `evaluateEntryBar` 调用返回 `eligible:false` 且 `reason` 明确指向该条件(不是同一句笼统文案)。
- [x] AC2 编号动态性 + 无冲突:stub `existingGoalIds={GOAL-030..036}` 时选出 `GOAL-037`;stub 追加 `GOAL-037` 后再调用时选出 `GOAL-038`——证明编号从输入动态算出,不是写死字面量。
- [x] AC3 结构红线:`grep -En 'status\s*[:=]\s*["'"'"']active["'"'"']|lifecycle_promote' docs/analysis/ownership-active-limited-proposal.mjs` 零命中。
- [x] AC4 写入即 draft:对一个满足全部四条准入条件的合成 eligible 记录调用 `proposeDraftGoal`,读回创建的 Goal,断言其 `status === "draft"`(不是 active),且 body 含"须人工审批"字样与证据链引用。
- [x] AC5 诚实的生产 dry run:对当前 develop 尖端跑一次真实 `evaluateEntryBar`(消费 `gap-architecture-evidence-store-and-decision-memory` 产出的真实记录),结果写入 `docs/analysis/architecture-evidence-store-limited-proposal-report.md`——无论是"未满足,还差 N 轮"还是"满足,已产出 draft Goal <id>",两者均视为达成;不得为了让本 AC 好看而拼出一个假 eligible 记录,真实读数如实记录即可。
- [x] AC6 全量回归绿:`bash scripts/test.sh --for-task gap-ownership-active-limited-proposal-mode` exit 0。

## DoD

`docs/analysis/architecture-evidence-store-limited-proposal-report.md` 提交,记录 AC5 的真实 dry-run 结果。若该轮确实产出了一个 draft Goal,报告里必须含该 Goal 的完整正文、预测 delta、可逆性评估,且该 Goal 在任务落地时仍是 `draft`(未被本任务或任何自动机制转为 `active`)——这是人工审批前的唯一合法终态。⛔ 本任务不激活任何 Goal,不开任何 goal branch,不执行任何重构代码改动;"是否批准该 draft 转 active"留给人在报告产出后单独裁定。全部新增测试绿。

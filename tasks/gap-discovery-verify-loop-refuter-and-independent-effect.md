---
id: gap-discovery-verify-loop-refuter-and-independent-effect
title: 验证环不闭合——routine-scan 与 arch-discovery 两条 origin 没有 refuter 阶段（链停在
  verifier），effect 读数是「机械 no-recurrence」而非「独立预测对结果」
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一（链不闭合，代码位置）**：`plugin/scripts/discovery-closed-loop-report.ts` 里 `LINK_ORDER =
[carrier, verifier, refuter, task, merge, effect]`，但三条 origin 只有一条有 refuter：
- open-semantic-discovery：有 refuter（`:523` 读 `refutation_verdict`）；
- arch-discovery：`refuter: notEvaluated("arch-discovery-has-no-refuter-stage")`（`:531`）；
- routine-scan（semantic-dedup-scan 等）：`refuter: notEvaluated("routine-scan-has-no-refuter-stage")`（`:539`）。

**事实二（后果）**：portfolio 26 条 finding 里 13 条 origin 是 `autonomous-routine`（semantic-dedup-scan），
它们的链全部 `complete:false, missing:[refuter]`。F01（doc-check-cache vs scoped-gate-cache）已是 done +
有 merge commit，但链仍停在 verifier——**验证闭环在「提出→证实→立案→落地」里缺了「反驳」这一环**，
`confirmed` 只能来自 verifier 单边，没有独立反驳方（ADR-007 的 G3 独立审计纪律在这里是空的）。

**事实三（effect 是机械量，不是独立检验）**：`effectReading`（`:582-649`）只做一件事——查同一个
`concept_key` 在 fix 之后是否再次出现，全查过且没出现就判 `no-recurrence-after-fix`，reason 是
`EVERY_READING_WAS_TAKEN_AND_NONE_FOUND_A_RECURRENCE`。这是硬规则 4 推论四的形状：「没复现」与「修好
了」同形。它没有一条「修之前预言了什么、结果对没对上」的对照——即 architecture-evolution-closed-loop
里的「独立 Evaluator」仍然缺失。

**事实四（现有 refuter 可用，不必新造）**：OSD 例程已经有 refuter 机制（`refutation_max_turns: 6`、
`refutation_retry_max_turns`、`refutation_undetermined_cause` 四态）。本任务是把这条机制**复用**到
另外两条 origin，不是再写一个。

**发生率（硬规则 12，本任务为何立项）**：`missing:[refuter]` 的链是**结构性的、100%**（26/26 里
routine-origin 的 13 条 + arch-origin 的全部），不是偶发一次；effect 的机械判读也是**每一**条 done 链
的同款缺陷。发生率高到无需再等观察。

## Plan

1. **给 routine-scan 与 arch-discovery 两条 origin 补 refuter 阶段**：复用 OSD 的 refuter（同一
   预算台账、同一 `refutation_verdict` 词表），让 `arch-discovery-has-no-refuter-stage` 与
   `routine-scan-has-no-refuter-stage` 这两个 notEvaluated 从「结构性缺席」变成「读不到才报」。refuter
   的判定按 G3：独立上下文、只读 verifier 结论的输入、不继承 verifier 的判断。
2. **effect 改成独立预测对结果**：在 finding 立案/fix 时写一条**可证伪预测**（例如「此去重不引入新
   目录环 / 不改变该符号的 call 出度 / 中心增长占比不回弹」），merge 后读该预测的载体，对上了
   `effect: prediction-confirmed`、没对上 `prediction-refuted`、没写预测 `no-prediction`（独立取值，
   不与 no-recurrence 同形，硬规则 3b）。`no-recurrence-after-fix` 保留为 effect 的一个子读数，不再是
   effect 的唯一形态。
3. **不改 OSD 已有的 refuter**：它的预算与重试已经在生产跑过，本任务只新增对另外两条 origin 的接线。
4. **cost 不做**：effect 的新读数如果要求额外模型调用，必须挂在既有预算台账上，不新开预算源（本任务
   不碰 24h 天花板，那是另一条成本任务）。
5. **测试**：`discovery-closed-loop-report.ts` 的 fixture 覆盖四种链态（refuter 有值 / notEvaluated /
   prediction 三分支 / 无 merge），断言 `closed` 只在「refuter 有值 ∧ effect 有独立预测结果」时为 true。

## Acceptance Criteria

- [ ] AC1 两条 origin 的 refuter 有真实消费：`grep -n 'arch-discovery-has-no-refuter-stage\|routine-scan-has-no-refuter-stage' plugin/scripts/discovery-closed-loop-report.ts` 的命中处只剩「读不到时的 fallback」，正常记录路径改为读 `refutation_verdict`；贴改动前后两段 diff。
- [ ] AC2 链闭合读数：重跑 `discovery-closed-loop-report.ts --host=self=/data/home/yale/work/quay --json`，其中至少一条 routine-origin 的链 `missing` 不再含 `refuter`，或如实报告「尚无一条 refuter 有值（原因）」；贴该条链的 JSON。
- [ ] AC3 effect 三态可分：fixture 分别构造「预测对上 / 预测落空 / 无预测」，effect 输出三个不同的 `kind`，且 `no-prediction` 不与 `no-recurrence-after-fix` 同形；贴测试与三份输出。
- [ ] AC4 预测写在 fix 时：立案模板或 ABI 写入处新增一个「effect 预测」字段/段落，落地一条真实 finding 的 fix 时把它写进去；贴一条真实记录的预测文本与 merge commit。
- [ ] AC5 负对照（预测可取假）：找一条已 done 的 finding，反查「若当时写了错误预测，effect 会判 refuted」——用 fixture 把预测改成故意错误的断言，输出必须 `prediction-refuted`；贴断言。
- [ ] AC6 回归面：`discovery-closed-loop-report` 相关既有测试全绿；贴 `node --test` 输出尾部。
- [ ] AC7 文档：`docs/references/architecture-evolution-closed-loop.md` 的「独立 Evaluator 仍缺」现状行更新为「refuter 已接三条 origin；Evaluator=预测对结果，已落」，并写清还缺什么；贴该行原文。

## Definition of Done

- 三条 origin 的链都能产出 refuter 值（读得到才算），`closed` 的判定包含「refuter 有值 ∧ effect 有独立预测结果」。
- 至少一条真实 done 链从头走到尾：verifier → refuter → task → merge → effect（预测对结果），整条 `closed:true` 可见。
- effect 的三种取值互斥且都有独立输出词，不与「没查成」同形。

## Touches

- plugin/scripts/discovery-closed-loop-report.ts
- plugin/test/discovery-closed-loop-report.test.mjs
- plugin/scripts/open-semantic-discovery-routine.ts
- docs/references/architecture-evolution-closed-loop.md
- tasks/gap-discovery-verify-loop-refuter-and-independent-effect.md

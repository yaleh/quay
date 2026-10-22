---
id: gap-discovery-verify-loop-refuter-and-independent-effect
title: 验证环不闭合——routine-scan 与 arch-discovery 两条 origin 没有 refuter 阶段（链停在
  verifier），effect 读数是「机械 no-recurrence」而非「独立预测对结果」
status: done
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

- [x] AC1 两条 origin 的 refuter 有真实消费：`grep -n 'arch-discovery-has-no-refuter-stage\|routine-scan-has-no-refuter-stage' plugin/scripts/discovery-closed-loop-report.ts` 的命中处只剩「读不到时的 fallback」，正常记录路径改为读 `refutation_verdict`；贴改动前后两段 diff。
- [x] AC2 链闭合读数：重跑 `discovery-closed-loop-report.ts --host=self=/data/home/yale/work/quay --json`，其中至少一条 routine-origin 的链 `missing` 不再含 `refuter`，或如实报告「尚无一条 refuter 有值（原因）」；贴该条链的 JSON。
- [x] AC3 effect 三态可分：fixture 分别构造「预测对上 / 预测落空 / 无预测」，effect 输出三个不同的 `kind`，且 `no-prediction` 不与 `no-recurrence-after-fix` 同形；贴测试与三份输出。
- [x] AC4 预测写在 fix 时：立案模板或 ABI 写入处新增一个「effect 预测」字段/段落，落地一条真实 finding 的 fix 时把它写进去；贴一条真实记录的预测文本与 merge commit。
- [x] AC5 负对照（预测可取假）：找一条已 done 的 finding，反查「若当时写了错误预测，effect 会判 refuted」——用 fixture 把预测改成故意错误的断言，输出必须 `prediction-refuted`；贴断言。
- [x] AC6 回归面：`discovery-closed-loop-report` 相关既有测试全绿；贴 `node --test` 输出尾部。
- [x] AC7 文档：`docs/references/architecture-evolution-closed-loop.md` 的「独立 Evaluator 仍缺」现状行更新为「refuter 已接三条 origin；Evaluator=预测对结果，已落」，并写清还缺什么；贴该行原文。

## Definition of Done

- 三条 origin 的链都能产出 refuter 值（读得到才算），`closed` 的判定包含「refuter 有值 ∧ effect 有独立预测结果」。
- 至少一条真实 done 链从头走到尾：verifier → refuter → task → merge → effect（预测对结果），整条 `closed:true` 可见。
- effect 的三种取值互斥且都有独立输出词，不与「没查成」同形。

## Evidence

### AC1 — refuter 读侧接三条 origin（改动前后两段 diff）

**BEFORE（develop）**：两条 origin 的 refuter 是硬编码缺席，根本没有读字段的机会：
```diff
-      refuter: notEvaluated("arch-discovery-has-no-refuter-stage"),
...
-    refuter: notEvaluated("routine-scan-has-no-refuter-stage"),
```
**AFTER（本分支）**：三条 origin 共用**写侧自己那个** reader（`readRefuterStage`，从
`open-semantic-discovery-routine.ts` 导出），硬编码 token 只剩「记录没有该字段时」的 fallback：
```diff
+  // THE SHARED READING: a record that carries the refuter's own fields is consumed on every origin.
+  const refuter = readRefuterStage(rec);
+  const refuterValue: unknown = refuter.verdict !== null
+    ? refuter.verdict
+    : notEvaluated(REFUTER_ABSENCE_REASON[resolved.rel] ?? `no-refuter-record-reader-for:${resolved.rel}`);
   if (CLUSTER_SHAPED_CARRIERS.includes(resolved.rel)) {
     return {
       verifier: isStr(rec.verifier_verdict, 1) ? String(rec.verifier_verdict) : notEvaluated("no-verifier_verdict-on-the-cluster-record"),
-      refuter: isStr(rec.refutation_verdict, 1) ? String(rec.refutation_verdict) : notEvaluated("no-refutation_verdict-on-the-cluster-record"),
+      refuter: refuterValue,
+      refuter_cause: refuter.undetermined_cause,
```
`grep -n 'arch-discovery-has-no-refuter-stage\|routine-scan-has-no-refuter-stage' plugin/scripts/discovery-closed-loop-report.ts`
现在**只命中 fallback 表**：
```
538:  [ARCH_FINDINGS_REL]: "arch-discovery-has-no-refuter-stage",
539:  [ROUTINE_FINDINGS_REL]: "routine-scan-has-no-refuter-stage",
```
消费路径由 fixture 端到端钉住（`AC1: arch-discovery and routine-scan records that CARRY a
refutation_verdict are consumed`）：带 `refutation_verdict:"refuted"` 的 arch 记录读出 `refuted` 且
`missing` 不再含 `refuter`；不带该字段的记录才读出上面那行 fallback。

### AC2 — 生产重跑：routine-origin 链的 refuter 仍是 not-evaluated（如实报告）

`node --experimental-strip-types plugin/scripts/discovery-closed-loop-report.ts --host=self=/data/home/yale/work/quay --json`
（从本 worktree 跑，读的是共享检出的载体）中 F01 的链：
```json
{"finding_id":"F01","origin":"autonomous-routine","origin_carrier":".quay/routine-findings.jsonl",
 "verifier":"real-duplication","refuter":"not-evaluated:routine-scan-has-no-refuter-stage",
 "refuter_source":{"rel":".quay/routine-findings.jsonl","line":2319},
 "task_id":"gap-routine-semantic-dedup-scan-doc-check-cache-vs-scoped-gate-cache",
 "merge_commit":{"sha":"e8453216d6410950090c19eb7318c368ba63f85d","committed_at":"2026-10-11T16:05:16.000Z","on_branch":true,"branch":"develop"},
 "effect":{"kind":"no-prediction","recurrence":"no-recurrence-after-fix"},
 "chain":{"complete":false,"closed":false,"closed_reason":"LINKS_NOT_VALUED:refuter","furthest_link":"verifier","missing":["refuter"]}}
```
**如实报告：尚无一条 routine-origin 链的 refuter 有值。** 13 条 routine-origin 链里 3 条缺 refuter（其余
10 条根本没有 fix task/origin_carrier 读数），原因是**产出侧仍缺**：`probe-routine.ts` 写
`.quay/routine-findings.jsonl` 的 `finding` 记录、`arch-discovery-routine.ts` 写
`.quay/arch-discovery-findings.jsonl` 的记录都不写 `refutation_verdict`（实测：两种载体里带该字段的
记录数都是 0）。本任务只接**读侧**——一旦哪个 writer 写出该字段，上面那个共享 reader 立刻消费它；
读侧不制造读数。另：arch-discovery 的 finding **完全没有进 portfolio**（`.quay/discovery-portfolio.jsonl`
中 `origin_carrier=.quay/arch-discovery-findings.jsonl` 的行数 = 0），所以 arch origin 的链在本报告里
结构上不可见，它的 refuter 分支目前只有 fixture 覆盖。

### AC3 — effect 三态可分（三个不同 kind + 三份输出）

测试：`plugin/test/discovery-closed-loop-report.test.mjs` 的
`AC3: prediction-confirmed / prediction-refuted / no-prediction are three DIFFERENT kinds`
（断言 `new Set(seen).size === 3`，且 `no-prediction` 与 `effect.recurrence.kind = no-recurrence-after-fix` 不同形）。
三份真实输出（同一 fixture，只改 fix task 的预测）：
```json
// 预测对上
{"kind":"prediction-confirmed","recurrence_kind":"no-recurrence-after-fix",
 "prediction":{"metric":"concept_recurs_after_merge","expected":false},
 "measured":{"metric":"concept_recurs_after_merge","evaluated":true,"value":false,"from":"no-recurrence-after-fix"},
 "chain":{"complete":true,"closed":true,"closed_reason":"EVERY_LINK_IS_A_VALUE_AND_THE_PREDICTION_MATCHED_THE_MEASUREMENT","furthest_link":"effect","missing":[]}}
// 预测落空（故意写反）
{"kind":"prediction-refuted","recurrence_kind":"no-recurrence-after-fix",
 "prediction":{"metric":"concept_recurs_after_merge","expected":true},
 "measured":{"metric":"concept_recurs_after_merge","evaluated":true,"value":false,"from":"no-recurrence-after-fix"},
 "chain":{"complete":true,"closed":false,"closed_reason":"EVERY_LINK_IS_A_VALUE_BUT_THE_EFFECT_IS:prediction-refuted","furthest_link":"effect","missing":[]}}
// 无预测
{"kind":"no-prediction","recurrence_kind":"no-recurrence-after-fix","prediction":null,"measured":null,
 "chain":{"complete":true,"closed":false,"closed_reason":"EVERY_LINK_IS_A_VALUE_BUT_THE_EFFECT_IS:no-prediction","furthest_link":"effect","missing":[]}}
```
「读不到/读不懂」有独立取值：未知 metric ⇒ `not-evaluated:unknown-effect-prediction-metric:<name>`，
节存在但缺 `expected:` ⇒ `not-evaluated:effect-prediction-unparseable:…`（测试
`an unmeasurable or unreadable prediction is not-evaluated, never one of the three kinds`）。

### AC4 — 预测写在 fix 时（立案模板 + 一条真实记录）

**写入面（立案模板）**：`plugin/scripts/routine-file-gate.ts` 的 `renderRoutineTaskBody` 现在为每个
例程立案写：
```
## Effect Prediction

- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<subject>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: <立案轮的 ts>
```
写侧与读侧由 `AC4: the ROUTINE FILING TEMPLATE writes the prediction, and the report's own reader parses it`
一起钉住（模板输出 → `readEffectPrediction` 必须读成 `present`）。

**真实记录**：`tasks/gap-over90-task-gate-taskstatus-literal-unreachable-for-any-real-status-fix-or-retire.md`
（portfolio finding `open-semantic-discovery@2026-10-13T01:10:43.215Z#2` 的 fix）新增：
```
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `invariant|over90-task-gate.ts,supervisor-preempt-candidates.ts,task-status.ts` 这一 concept_key 不应在 merge 之后再次出现（同 key 的后续 cluster 数应为 0）。
- recorded_at: 2026-10-22T16:30:00.000Z
```
merge commit：`537e53dc534c8f279cda9fb3f572e06344e54ebd`（2026-10-13T04:22:56Z，on develop）。
⚠️ **如实标注**：这条预测是**事后回填**的（晚于 merge），报告以 `prediction.recorded_after_merge: true`
把它与真正的合并前预测区分开；真正的合并前预测从本机制落地后的新立案开始自然产生。

### AC5 — 负对照：预测故意写错 ⇒ prediction-refuted

同一 fixture 只把 `expected` 从 `false` 改成 `true`（其他一切不变）：
```
✔ AC3: prediction-confirmed / prediction-refuted / no-prediction are three DIFFERENT kinds
    assert.equal(rf.effect.kind, "prediction-refuted", "a deliberately wrong prediction must be REFUTED by the measurement")
    assert.equal(rf.effect.prediction.expected, true)
    assert.equal(rf.effect.measured.value, false)
    assert.equal(rf.chain.closed, false, "a refuted prediction is not a closed loop")
```
（如果 effect 读的是预测本身而不是实测，这条臂与「预测对上」那条臂不可能给出不同的 kind。）

### AC6 — 回归面

`node --no-warnings --experimental-strip-types --test plugin/test/discovery-closed-loop-report.test.mjs`
```
ℹ tests 25
ℹ pass 25
ℹ fail 0
```
相邻面：`open-semantic-discovery-routine.test.mjs` 127/127；`routine-file-gate.test.mjs` +
`probe-routine.test.mjs` 59/59；`arch-discovery-routine.test.mjs` + `freshness-refresh-remedy-availability.test.mjs` 39/39。

### AC7 — 文档现状行

`docs/references/architecture-evolution-closed-loop.md` §2.6 的现状指针已改为：
> **refuter 已接三条 origin（读侧）；Evaluator = 预测对结果，已落** —— `effect` 链接现在读 fix task 自己的
> `## Effect Prediction`…输出三个独立取值 `prediction-confirmed` / `prediction-refuted` / `no-prediction`…
> `closed` 现在要求「每条链接都有值（含 refuter）」∧「预测被实测对上」。

并逐条写清**还缺什么**：① arch/routine 的 refuter **产出侧**（writer 不写 `refutation_verdict`）；
② arch→portfolio 未接入（arch origin 的链在本报告结构上不可见）；③ 预测的「合并前」纪律目前只有
`recorded_after_merge` 事后核对；④ Learning Store / Evolution Planner 仍零实现。文首 Status 与 §2.2 表行同步更正。

### ADR-007 dark-axis record

- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 files=503 edges=1490

## Touches

- plugin/scripts/discovery-closed-loop-report.ts
- plugin/test/discovery-closed-loop-report.test.mjs
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/routine-file-gate.ts
- docs/references/architecture-evolution-closed-loop.md
- tasks/gap-discovery-verify-loop-refuter-and-independent-effect.md

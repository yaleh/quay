---
id: gap-architecture-evidence-store-and-decision-memory
title: architecture evidence store + decision memory + quality/cost metrics for
  the ownership-active investigation loop (phase A+B of end-to-end architecture
  self-bootstrap)
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

<!-- dedup-ref -->
本任务是「端到端架构自举实验」(用户 2026-10-11 批准推动)的阶段 A+B,承接已 done 的 `gap-ownership-active-investigation-loop-shadow`——该任务证明了有界证据取证机制前提已满足,但 `docs/analysis/ownership-active-replay.md` 的 DoD 明确记录证据前提未满足:生产 live shadow 0/3 产出计算后的切片、T1 发现不稳定、**无决策记忆**(一次提案重提了已被豁免的 `github-client.ts` 状态字面量项)。本任务修这两个具体缺口(决策记忆 + 量化读数),不碰该机制"只写 shadow carrier、不建真实 Goal/task"这条红线——那是后续任务 `gap-ownership-active-limited-proposal-mode` 的范围,本任务不碰。

## Proposal

现有 `docs/analysis/ownership-active-*.mjs` 只有一种终态记录(写入 `.quay/ownership-shadow-proposals.jsonl` 的 proposal envelope),没有区分"证据/假设/实验/结果"四种对象,也没有"这件事以前判过、别重判"的记忆,也没有任何对"发现质量/证据成本/误报率/局部性/恢复轮数"的量化读数——用户要求的"Architecture Evidence/Hypothesis/Experiment/Outcome 最小结构化载体"与"量化发现质量/证据成本/误报/局部性/恢复"在现有机制里都不存在。

新增三个纯函数模块(复用既有 `ownership-active-*.mjs` 的风格:判定与 I/O 分离,LLM 只出结构化决定,JS 做计算):

1. `docs/analysis/architecture-evidence-store.mjs`——`appendEvidenceRecord`/`appendHypothesisRecord`/`appendExperimentRecord`/`appendOutcomeRecord`,写入新载体 `.quay/architecture-evidence-store.jsonl`(gitignored,同 `.quay/ownership-shadow-proposals.jsonl` 既有惯例)。四类记录各有必填字段集,`evidence` 类必须带 `{tool, ref(commit sha), path+range 或 scope+flags, ts, sha256, confidence}`——缺字段时 fail-closed 拒绝写入(抛错/返回显式失败,不静默吞掉、不补默认值)。
2. `docs/analysis/architecture-decision-memory.mjs`——`isKnownExemption(candidate)`,内置一份真实已记录的豁免/缺陷清单(至少含 `ownership-active-replay.md` 记录的 `github-client.ts` 状态字面量豁免案例;可从 `gap-abi-status-lifecycle-vocab-scattered-no-named-type` 的 AC2 豁免记录与 GOAL-036 body「相关但本轮不落地」一节记录的 `flipGoal` `disposeOld.to==="achieved"` 不追记 statusLog 缺陷取种子数据,后者标注为"已知但未立案"而非"已豁免",两者语义不同,模块需要区分 `exempted` vs `known-not-yet-filed` 两种命中类型)。
3. `docs/analysis/architecture-metrics.mjs`——`computeRunMetrics(runRecord, holdoutGroundTruth?)`,产出 `{evidenceCost:{rounds,requests,bytes}, falsePositiveRate, locality, recoveryRounds}`;无 ground truth(生产实跑)时后三项必须显式 `not-evaluated`,不得猜测或留空(硬规则 6:缺值=未查,不是为假)。

## Plan

1. 写 `architecture-evidence-store.mjs`:四个 append 函数 + 对应的 schema 校验器,校验器对每类记录的必填字段做存在性+类型检查,测试覆盖"缺一个必填字段 ⇒ 拒绝写入,文件未被追加"。
2. 写 `architecture-decision-memory.mjs`:`isKnownExemption` 用候选的 concern_kind + 涉及文件路径做匹配(不是关键词匹配,按位置/结构判定,同硬规则 2);种子清单以模块内常量数组声明,每条带来源引用(task id 或 GOAL id + 一句原因)。
3. 写 `architecture-metrics.mjs`:`evidenceCost` 直接从 run 记录的 requests/bytes 读;`falsePositiveRate`/`locality`/`recoveryRounds` 只在传入 `holdoutGroundTruth` 时计算,否则返回 `{state:"not-evaluated"}`。
4. 在 `docs/analysis/ownership-active-loop.mjs` 的终态分支(`propose_slice` 之前)接入 `isKnownExemption`——命中 `exempted` 时终态改写为 `abstain`,原因字段记 `known-exemption`;同时把每轮的证据/假设/实验/结果通过新模块写入新载体(不只写旧 proposal carrier,两个载体并存,旧的继续用于兼容现有 `ownership-shadow-proposer.mjs` 消费链)。**不新增任何向 `fileProposals`/`driveItems`/`fileDecisions` 的 import**——`plugin/test/ownership-active-loop.test.mjs` 已有的结构性断言必须继续通过。
5. **Holdout A(复用)**:对既有 `docs/analysis/ownership-active-replay.md` 记录的 GOAL-032/033 25 条回放记录重跑一次(用新模块),产出 outcome 记录,核对决策记忆对历史误判案例(github-client.ts 重提)的命中——这是本任务唯一允许"预先知道答案"的语料,因为它的作用正是验证决策记忆有没有把旧误判挡住。
6. **Holdout B(新增,盲测)**:对 GOAL-034/035/036 各自的 fork-point commit(`162f8c380ed1dd9267167cc791ef8727fd13269d`、`1b87254733ca2ac33412e708c65ea2d1e160f9c1`、`8cb36c2fd94616aa7169dbe475d6671ee939adf6`,均已在对应 GOAL body 的「验证步骤」第 1 步记录)各跑一次有界 live-shadow investigation——只给投研器 fork-point 时刻能看到的代码与证据预算,不读对应 GOAL 正文的调查结论、不读 `docs/architecture/quay-domain-model-2026-10-11.md` 的候选清单(防作弊)。产出的 outcome 记录与 Holdout A 的记录、与决策记忆种子清单的 id 集合必须零交集(后续任何训练/种子语料都不得包含 Holdout B 的 id——反作弊隔离)。
7. **生产实跑**:对当前 develop 尖端跑至少 3 轮真实(非回放)live shadow investigation,产出的 outcome 记录里 `evidenceCost` 必须非空,`falsePositiveRate`/`locality` 必须显式 `not-evaluated`(生产跑没有 ground truth)。
8. 报告写入 `docs/analysis/architecture-evidence-store-replay.md`:Holdout A/B 的量化读数、生产 3 轮读数、决策记忆命中/未命中清单、与既有 `ownership-active-replay.md` 的差异点。

## Touches

- docs/analysis/architecture-evidence-store.mjs
- docs/analysis/architecture-decision-memory.mjs
- docs/analysis/architecture-metrics.mjs
- docs/analysis/ownership-active-loop.mjs
- docs/analysis/architecture-evidence-store-replay.md
- plugin/test/architecture-evidence-store.test.mjs
- plugin/test/architecture-decision-memory.test.mjs
- plugin/test/architecture-metrics.test.mjs
- plugin/test/ownership-active-loop.test.mjs
- plugin/fixtures/ownership-active-slice/goal-034-fork-point.arch.json
- plugin/fixtures/ownership-active-slice/goal-035-fork-point.arch.json
- plugin/fixtures/ownership-active-slice/goal-036-fork-point.arch.json
- tasks/gap-architecture-evidence-store-and-decision-memory.md

## AC

- [ ] AC1 新载体 schema 校验:对 `architecture-evidence-store.mjs` 的四个 append 函数,各构造一条缺必填字段(`evidence` 类缺 `ref`)的记录调用,断言写入被拒绝(抛错或返回 `{ok:false}`)且 `.quay/architecture-evidence-store.jsonl` 未被追加该条;正常完整记录能成功追加并可读回。
- [ ] AC2 决策记忆回归:用 `ownership-active-replay.md` 记录的历史误判输入(重提 `github-client.ts` 状态字面量)重放,断言新流程输出为 `abstain(known-exemption)`,与历史记录的旧输出(`propose_slice` 误提案)不同。
- [ ] AC3 Holdout A 量化读数:对既有 25 条 GOAL-032/033 回放记录跑 `computeRunMetrics`,产出的 outcome 记录可读、`evidenceCost`/`falsePositiveRate`/`locality`/`recoveryRounds` 四项均为具体数值(非 not-evaluated,因为有 ground truth)。
- [ ] AC4 Holdout B 盲测 + 反作弊隔离:对 GOAL-034/035/036 三个 fork-point commit 各跑一次盲投研,三条记录写入新载体;`jq` 交集检查确认这三条记录的 id 与 Holdout A 25 条记录的 id、与决策记忆种子清单引用的 id,三者两两交集为空。
- [ ] AC5 生产实跑 not-evaluated 诚实性:对 develop 尖端跑 ≥3 轮真实 live shadow,产出的 outcome 记录里 `falsePositiveRate`/`locality` 字段值严格等于 `{state:"not-evaluated"}`(不是猜测值、不是省略字段)。
- [ ] AC6 结构红线不回退:`plugin/test/ownership-active-loop.test.mjs` 既有"不 import fileProposals/driveItems/fileDecisions"断言测试,在本任务改动后继续通过(`node --test plugin/test/ownership-active-loop.test.mjs` exit 0)。
- [ ] AC7 全量回归绿:`bash scripts/test.sh --for-task gap-architecture-evidence-store-and-decision-memory` exit 0。

## DoD

`docs/analysis/architecture-evidence-store-replay.md` 提交,记录 Holdout A(25 条,已知答案)与 Holdout B(3 条,盲测,GOAL-034/035/036 fork-point)的五项量化读数对比、生产 3 轮 live shadow 的 `evidenceCost` 读数与 `not-evaluated` 诚实性、决策记忆命中/未命中清单(至少 1 条命中案例 = github-client.ts 回归)。⛔ 本任务不创建、不激活任何 Goal/task,不改变机制"只写 shadow carrier"的性质——向真实 Goal 的受限提案是 `gap-ownership-active-limited-proposal-mode` 的范围,本任务只负责证据/决策记忆/量化读数三件事。全部新增测试 + 既有 `ownership-active-loop.test.mjs` 绿。

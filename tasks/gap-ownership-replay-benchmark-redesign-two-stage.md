---
id: gap-ownership-replay-benchmark-redesign-two-stage
title: "ownership replay benchmark redesign: T0/T1 two-stage corpus, falsifiable
  granularity, alternative-answer tolerance, Flash-vs-Opus re-run"
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务新增的是只读 corpus/评测器与测试，不 import/不改变任何生产包间依赖边，也不碰 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Finding

对 `gap-meta-driver-offline-replay-corpus-goal030-033` 的 v1 benchmark 做设计审计后确认**它测的不是它声称的东西**——A/B 跑出「Flash 与 Opus 无差别」的原因主要在 benchmark，不在模型。审计出的四类缺陷：

1. **T0/T1 混淆（gold 问题，最关键）**：四例的 `input.json` 用的是「发现 concern 时」的信息状态，却对「决策就绪」时的 gold 打分。GOAL-032 的 origin 明写「结论 equivalent **后**创建并激活」，而 v1 的 input 早已带 `equivalence_investigation_status` —— 拿 T0 输入对 T1 gold。
2. **单一 gold（gold 问题）**：`reference.json` 只有一个 `selected_slice`，全仓无 `alternat*` 字段；匹配器是纯词元重叠（`overlapScore`，无词干/同义/语义），等价但措辞不同的合理切法一律判 `no_match`。
3. **granularity 恒真（evaluator 问题）**：四例 `granularity_label` 全是 `sufficient` 且无负样本 ⇒ 该维度 4/4「agreement」但判别力为零。
4. **evidence 过薄（evidence 问题）**：模型实际收到约 600 字符——GOAL-030 是 5 个标量、其余三例是**一句散文**；`goals/tasks.status_tally` 是空对象 `{}`；methodology 只给 12 个标题。而人当时有整个 repo。

**实测佐证**：v1 corpus 每组 8 次（reps=2，16 run）——A 与 B 在每一维上**完全相同**（ivn 0/8、recall 4/8、scopeViol 0/8、harness_ready 8/8）。此前由 n=1 得出的「B 有 scope 回退」**未复现**。

## Plan (as executed)

1. **T0/T1 重建**：逐 case 定 `T0-concern-discovery` 与 `T1-decision-ready`（T1 一律在 `activatedAt` 前 5 分钟），T0 只含发现期可见信息，T1 加入人当时确实做过的调查结论。产物 `stage_a.json` / `stage_b.json`。
2. **拆两阶段**：Stage A=discovery（≤3 concerns + evidence refs + 是否需调查 + confidence，允许 abstain）；Stage B=decomposition（给已确认 concern + T1 findings，产出 candidate slices / 推荐首个 / investigate-vs-goal / scope+non-goals / delta / negative control / harnessability 五要素 / abandon 条件 / 最小充分性理由）。
3. **gold 改造**：`reference.json` 增 `alternative_valid_slices`（每例 ≥2）、`adjacent_reasonable_slices`、`clearly_too_broad`、`clearly_too_fragmented`、`minimum_sufficiency_rationale`、`timeline`、`t1_belief_gaps`。`selected_slice` 匹配**降级为辅助指标**。
4. **evaluator 改造**：`ownership-two-stage-evaluator.mjs` 分阶段输出；granularity 依反事实集判 `too-broad` / `too-fragmented` / `sufficient` / `unclassified_novel`（**可取假**）；无法归类的合理新切法标 `manual_review` 而非判错；`investigate-vs-goal` **只在 T1 打分**；无单一总分。
5. **hindsight 控制**：GOAL-033 真实 T1 信念是 SCC 6→5（6→4 是事后实测），该更正只记在 `reference.t1_belief_gaps`，⛔ 不进 prompt（已由测试钉死）。
6. **重跑 A/B**：A=`claude-fjdac`/`v4.1flash-anthropic`（DeepSeek V4.1-Flash via LiteLLM 网关），B=`claude`/`opus`（原生 claude.ai）。fixture profile 承载，**不改 `.quay/profiles.yml`**；B 经 wrapper 丢弃网关路由 env（否则 `ANTHROPIC_DEFAULT_OPUS_MODEL` 会把 opus 静默改写成 DeepSeek——本任务实测踩到过）。同 case 同 stage 的 prompt 字节级相同（harness 自检断言）。

## Touches

- plugin/fixtures/meta-driver-replay/GOAL-030/stage_a.json
- plugin/fixtures/meta-driver-replay/GOAL-030/stage_b.json
- plugin/fixtures/meta-driver-replay/GOAL-031/stage_a.json
- plugin/fixtures/meta-driver-replay/GOAL-031/stage_b.json
- plugin/fixtures/meta-driver-replay/GOAL-032/stage_a.json
- plugin/fixtures/meta-driver-replay/GOAL-032/stage_b.json
- plugin/fixtures/meta-driver-replay/GOAL-033/stage_a.json
- plugin/fixtures/meta-driver-replay/GOAL-033/stage_b.json
- plugin/fixtures/meta-driver-replay/GOAL-030/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-031/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-032/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-033/reference.json
- docs/analysis/two-stage-corpus-spec.json
- docs/analysis/gen-two-stage-corpus.mjs
- docs/analysis/ownership-two-stage-evaluator.mjs
- docs/analysis/ownership-two-stage-ab.mjs
- plugin/test/ownership-two-stage-corpus.test.mjs
- tasks/gap-ownership-replay-benchmark-redesign-two-stage.md

## AC

- [ ] T0 < T1 ≤ activatedAt，且两个 stage 文件对每例都存在并声明正确 stage。
- [ ] **反泄漏**：四例的 outcome/solution 标识符（如 `task-transition.ts`、`verdict-parse.ts`、`driver-control.ts`、`6 -> 4`）在两个 stage 文件中零命中。
- [ ] **T0 不含调查结论**：GOAL-032 的 T0 不含 equivalence 结论；GOAL-033 的 T0 不含 `exactly 2` 边枚举；GOAL-031 的 T1（而非 T0）才带 false-positive 分类。
- [ ] **hindsight 只在 evaluator 侧**：`not_established_at_T1` 字段不出现在任何 stage 文件；`reference.t1_belief_gaps` 存在。
- [ ] **granularity 可取假**：每例的 too-broad 与 too-fragmented 反事实分别判为 `too-broad` / `too-fragmented`，reference slice 判为 `sufficient`。
- [ ] **允许多解**：每例 `alternative_valid_slices` ≥2。
- [ ] Stage A 能区分「正确 abstain」与「漏掉可见 concern」，并把杜撰的 evidence ref 报为 unsupported。
- [ ] `node --experimental-strip-types --test plugin/test/ownership-two-stage-corpus.test.mjs` 全绿。
- [ ] A/B 对照结果写入 `docs/analysis/ownership-two-stage-ab-results.json`，且 harness 自检 `prompts_identical_across_groups_per_cell` 为真。

## DoD

真实落地 = 上述 fixture/评测器/测试随本任务提交进 develop；两阶段 A/B 结果是对**真实 corpus** 的直接读数，可重跑复现。⛔ 本任务不改线上自治、不切生产模型配置（`.quay/profiles.yml` 保持原样，已由 `git status` 核验）。结论段必须诚实区分：模型能力 / evidence 充分性 / prompt bias / gold-evaluator 四类成因各自贡献多少。
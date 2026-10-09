---
id: gap-ownership-replay-benchmark-redesign-two-stage
title: "ownership replay benchmark redesign: T0/T1 two-stage corpus, falsifiable
  granularity, alternative-answer tolerance, Flash-vs-Opus re-run"
status: ready
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

v1 benchmark（`gap-meta-driver-offline-replay-corpus-goal030-033`）**测的不是它声称的东西**。实测：v1 corpus 每组 8 次（reps=2，16 run）A 与 B 在每一维上完全相同（ivn 0/8、recall 4/8、scopeViol 0/8、harness_ready 8/8）；此前由 n=1 得出的「B 有 scope 回退」**未复现**。审计出四类缺陷：

1. **T0/T1 混淆（gold，最关键）**：input 用「发现 concern 时」的信息状态，却对「决策就绪」时的 gold 打分。GOAL-032 的 origin 明写「结论 equivalent **后**创建并激活」，而 v1 input 早已带 `equivalence_investigation_status`。
2. **单一 gold**：只有 `selected_slice`，全仓无 `alternat*` 字段；匹配器是纯词元重叠（无词干/同义/语义）。
3. **granularity 恒真**：四例全 `sufficient` 且无负样本 ⇒ 4/4「agreement」但判别力为零。
4. **evidence 过薄**：模型实际收到 **1,003–2,102 字符**（stage A 最少 1.0 KB），而 ArchGuard 单个快照 2.0 MB、`packages/quay/src` 48,728 行。压缩比约 **1/1000**。

## Plan (as executed)

1. **T0/T1 重建**：T1 一律 = `activatedAt` − 5 分钟；T0 只含发现期信息。products `stage_a.json` / `stage_b.json`。
2. **两阶段**：Stage A=discovery（≤3 concerns + evidence refs + 是否需调查 + confidence，允许 abstain）；Stage B=decomposition（已确认 concern + T1 findings → candidate slices / 推荐首个 / investigate-vs-goal / scope+non-goals / delta / negative control / harnessability 五要素 / abandon / 最小充分性理由）。
3. **gold 改造**：每例 `alternative_valid_slices` ≥2 + `adjacent_reasonable` + `clearly_too_broad` + `clearly_too_fragmented` + `minimum_sufficiency_rationale` + `timeline` + `t1_belief_gaps`；`selected_slice` 匹配**降级为辅助**。
4. **evaluator 改造**：granularity 可取假（`too-broad`/`too-fragmented`/`sufficient`/`unclassified_novel`）；无法归类的合理新切法标 `manual_review` 而非判错；`investigate-vs-goal` **只在 T1 打分**；无单一总分。
5. **hindsight 控制**：GOAL-033 真实 T1 信念是 6→5（6→4 为事后实测），只记 `reference.t1_belief_gaps`，⛔ 不入 prompt（测试钉死）。
6. **重跑 A/B**：A=`claude-fjdac`/`v4.1flash-anthropic`（DeepSeek V4.1-Flash via LiteLLM），B=wrapper→`claude`/`opus`（原生 claude.ai）。fixture profile 承载，⛔ 未改 `.quay/profiles.yml`。

## Touches

- plugin/fixtures/meta-driver-replay/GOAL-030..033/{stage_a,stage_b,reference}.json
- docs/analysis/{two-stage-corpus-spec.json,gen-two-stage-corpus.mjs,ownership-two-stage-evaluator.mjs,ownership-two-stage-ab.mjs}
- docs/analysis/ownership-two-stage-ab-results.json
- docs/analysis/ownership-two-stage-ab.md
- plugin/test/ownership-two-stage-corpus.test.mjs
- tasks/gap-ownership-replay-benchmark-redesign-two-stage.md

## AC

- [x] T0 < T1 ≤ activatedAt，两个 stage 文件齐全且声明正确。**Verified**.
- [x] **反泄漏**：四例 outcome/solution 标识符在两个 stage 文件零命中。**Verified**（含中途自查——`not_established_at_T1` 一度被我写进 model-facing 的 `stage_b.json`，会直接告诉模型 6→4 是什么，已移出）。
- [x] **T0 不含调查结论**：GOAL-032 T0 无 equivalence 结论；GOAL-033 T0 无 `exactly 2`；GOAL-031 的 false-positive 分类在 T1。**Verified**.
- [x] **hindsight 只在 evaluator 侧**。**Verified**.
- [x] **granularity 可取假**：每例 too-broad/too-fragmented 反事实分别判对，reference slice 判 `sufficient`。**Verified**.
- [x] **允许多解**：每例 `alternative_valid_slices` ≥2。**Verified**.
- [x] Stage A 区分正确 abstain 与漏判，并把杜撰 ref 报 unsupported。**Verified**.
- [x] 10/10 integrity tests 全绿。**Verified**.
- [x] A/B 结果落 `docs/analysis/ownership-two-stage-ab-results.json`，自检 `prompts_identical_across_groups_per_cell` 为真。**Verified**.

## DoD

**结果（16 run，1 rep/cell）**：

- **Stage A（T0）**：A(Flash) 4/4 valid+grounded+rank-1；B(Opus) 3/4（GOAL-032 未命中）。
- **Stage B（T1）**：**investigate-vs-goal 两组各 4/4** —— 对比 v1 的 **0/8 vs 0/8**（同样的模型）。**这是本次最大的结果：v1 的失败是 T0/T1 gold 错配，不是模型能力；改造后该失败完全消失。**
- **残留**：两组**没有任何一例**达到 `sufficient` granularity（0/8）。Flash 倾向 under-scope（3/4 too-fragmented），Opus 倾向 over-scope（3/4 too-broad）。slice 匹配：`alternative_valid` 两组各 4/4，而匹配历史 slice 只有 2–3/4 —— **正是 v1 判成 `no_match` 的那些答案**。
- scope violation 各 1/4；harness 5/5 各 4/4；falsifiability substantive 各 4/4；delta quantified A 4/4、B 3/4。

**四类成因归属**：gold/evaluator = **主因且已修**（0/8→8/8 的翻转是唯一变量）；evidence sufficiency = **主因且未修**（0/8 达不到 sufficient，1–2 KB 对 2 MB 快照）；model capability = **不支持**（Flash 在 Stage A 反而更好，Stage B 完全持平，唯一差异是风格方向）；prompt bias = 部分已缓解。

**结论**：**不建议**基于本证据把 meta-driver/selector/pool-judge 切到 Opus——没有能力信号支持，Flash 更便宜且 Stage A 更好。当前约束是 evidence 而非模型；应先按审计结论展开 evidence bundle（SCC 边表、import 行、consumer 列表、duplicate 片段、methodology 正文）再重跑。

⛔ 本任务未改线上自治、未切生产模型配置（`.quay/profiles.yml` 保持原样）。结果 JSON 已经凭证扫描（`sk-` 0、API key 值 0）；仅记录 launcher/model/argv 级 provenance，无 credential。
---
id: gap-ownership-shadow-proposer-contract-and-replay
title: "ownership/architecture shadow proposer: project-local contract +
  deterministic gate + offline replay over the GOAL-030..033 corpus (no
  task/goal creation)"
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务新增的是离线 proposer 模块 + 回放 runner + 只读评测脚本（跑在既有 corpus 上、只写 sandbox 载体），不 import/不改变任何生产包间依赖边、不碰 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Proposal

验证「specialized proposer + deterministic policy + sandbox carrier」这条路是否比 monolithic meta-driver 更接近人工驱动 GOAL-030~033 的决策方式。**本任务只做离线部分**：契约 + 确定性闸 + 对既有 4-case corpus 的回放评分。⛔ 不注册 live shadow（那是后续任务）、⛔ 不创建任何 task/goal/AC、⛔ 不改 meta-driver.ts、⛔ 不新增 driver kind。

**复用优先**（用户显式约束）：评分直接复用 `plugin/test/helpers/meta-driver-replay-harness.mjs` 的 `buildDefaultPrompt` / `scoreResponse` / `loadCaseReference`（⛔ 不重写第二份 evaluator，否则两个度量面立刻漂移）；默认 prompt 只喂 `input.json`（harness 已有行为不变式与测试钉死）。

**ownership 边界（⛔ 不许泛化成产品规划器）**：owned concern 只限 ownership / canonicalization / dependency-boundary / small-slice architecture opportunities。越界提案由确定性闸拒绝。

## Plan

1. `docs/analysis/ownership-shadow-proposer.mjs` — proposer 模块，单一入口 `propose(evidence) -> envelope`：
   - **输入**（只吃机械证据，⛔ 不自己采证）：ArchGuard 类读数（dispersion / duplicate / cycle / package fan-in-out）、近期 goal/task/outcome 摘要、corpus 的 `input.json` context。
   - **输出**固定 envelope（字段与用户列的 10 项一一对应）：`proposer_id, concern, evidence_refs[], candidate_interventions[<=3], recommended_next_action ∈ {abstain, investigate, propose-goal}, scope{in_scope[], non_goals[]}, expected_mechanical_delta, negative_control, abandon_or_reconsider_condition, confidence{level, basis}`。
2. `deterministicGate(envelope, opts)` — **纯函数**，负责：schema 完整性、`evidence_refs` 逐条可解析（⛔ 引用不存在的读数 ⇒ 拒，硬规则 3b）、scope 越界（concern 不属于 ownership 域 ⇒ 拒）、forbidden actions（出现 `create-task`/`activate-goal`/`write-status` 之一 ⇒ 拒）、每轮 ≤3 提案、去重（按 concern 的规范化键，与 `routine-file-gate.ts` 同形）。⛔ 闸不调用 LLM。
3. `docs/analysis/ownership-shadow-replay.mjs` — 回放 runner：对 4 个 case 各 `buildDefaultPrompt` → 产出 envelope（离线、可注入 candidate；无 LLM 时用**确定性 stub proposer** 从 `input.json` 的机械读数派生，保证 runner 无需外部模型即可跑通）→ 过闸 → 过 `scoreResponse` → 汇总指标。
4. **输出** `docs/analysis/ownership-shadow-replay.results.json`：逐 case 的 concern recall/precision、slice agreement、investigate-vs-goal、scope violation、expected-delta quality、negative-control presence、abstention quality + 闸的 accept/reject 与理由 + 汇总。
5. **sandbox 载体**：proposer 只写 `.quay/ownership-shadow-proposals.jsonl`（gitignored）。⛔ 代码层面不 import `fileProposals`/`driveItems`/`fileDecisions`——用测试断言「该模块的 import 图里没有这三个符号」把这条**结构性**钉死，而不是靠纪律。
6. `docs/analysis/ownership-shadow-replay.md`：指标 + 诚实结论（含「4 个 case 不足以证明泛化」的边界声明），并给出**是否值得进入 limited-proposal stage** 的判断及其依据。

## Touches

- docs/analysis/ownership-shadow-proposer.mjs
- docs/analysis/ownership-shadow-replay.mjs
- docs/analysis/ownership-shadow-replay.results.json
- docs/analysis/ownership-shadow-replay.md
- plugin/test/ownership-shadow-proposer.test.mjs
- tasks/gap-ownership-shadow-proposer-contract-and-replay.md

## AC

- [ ] `node docs/analysis/ownership-shadow-replay.mjs --out docs/analysis/ownership-shadow-replay.results.json` 退出 0，且 4 个 case 各有结果：`node -e 'const r=require("./docs/analysis/ownership-shadow-replay.results.json"); process.exit(Object.keys(r.cases).length===4?0:1)'`。
- [ ] **结构性 sandbox 保证**（测试断言，非散文）：`plugin/test/ownership-shadow-proposer.test.mjs` 断言 proposer 模块源码**不含** `fileProposals` / `driveItems` / `fileDecisions` 的引用，且不含任何 `task_write`/`goal` 写调用 ⇒ 退出 0。
- [ ] **确定性闸可拒**（负对照，每条一个用例）：构造 4 个坏 envelope（缺字段 / evidence_ref 不存在 / concern 越界成产品规划 / recommended_next_action 越权为 create-task），闸必须**逐条拒绝并给出可区分的理由**（⛔ 四种拒因不得同形——硬规则 3b）。
- [ ] **闸可放行**：一个合法 envelope 必须 accept（⛔ 防止闸恒拒导致「全绿」假象）。
- [ ] 回放指标写入 results.json 且非退化：每个 case 的 `scoreResponse` 输出含全部维度键（concern_recall/slice/granularity/harnessability/... ），`node -e` 逐 case 断言键存在。
- [ ] 未创建任何 task/goal：`git status --porcelain tasks/ goals/` 除本任务自身外无新增。
- [ ] `plugin/scripts/meta-driver.ts` 未被本任务改动。

## DoD

真实落地 = 产物随本任务提交进 develop；`results.json` 是对**真实 `plugin/fixtures/meta-driver-replay/` corpus** 的直接回放读数（审阅者可重跑同一命令复现）。**⛔ 不在本任务内注册 live shadow、不自动激活 proposer、不写任何非 sandbox 载体。** 结论段必须诚实标注：4 个 case、单一领域，**不足以**声称已证明泛化；是否进入 limited-proposal 只给「有依据的建议」，不是自动推进。
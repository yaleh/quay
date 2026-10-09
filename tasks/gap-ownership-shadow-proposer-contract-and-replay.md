---
id: gap-ownership-shadow-proposer-contract-and-replay
title: "ownership/architecture shadow proposer: project-local contract +
  deterministic gate + offline replay over the GOAL-030..033 corpus (no
  task/goal creation)"
status: ready
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

- docs/analysis/ownership-shadow-proposer.mjs (new)
- docs/analysis/ownership-shadow-replay.mjs (new)
- docs/analysis/ownership-shadow-replay.results.json (new)
- docs/analysis/ownership-shadow-replay.md (new)
- plugin/test/ownership-shadow-proposer.test.mjs (new)
- tasks/gap-ownership-shadow-proposer-contract-and-replay.md
- .gitignore (modified — the sandbox carrier's ignore entry)

## AC

- [x] `node docs/analysis/ownership-shadow-replay.mjs --out docs/analysis/ownership-shadow-replay.results.json` 退出 0，且 4 个 case 各有结果：`node -e 'const r=require("./docs/analysis/ownership-shadow-replay.results.json"); process.exit(Object.keys(r.cases).length===4?0:1)'`。—— 在隔离镜像（`/tmp/peercheck`，`plugin/` 符号链接到 worktree）直接跑 develop 上交付的 `docs/analysis/ownership-shadow-replay.mjs --out …`：exit 0，`cases: 4`。
- [x] **结构性 sandbox 保证**（测试断言，非散文）：`plugin/test/ownership-shadow-proposer.test.mjs` 断言 proposer 模块源码**不含** `fileProposals` / `driveItems` / `fileDecisions` 的引用，且不含任何 `task_write`/`goal` 写调用 ⇒ 退出 0。—— develop 交付的 test `structural sandbox: the proposer module cannot reach the task/goal-writing machinery` 绿：先 `stripComments` 再断言（⛔ 按位置判定而非关键词 grep，硬规则 2），proposer/replay 源码在代码位不含 `fileProposals`/`driveItems`/`fileDecisions`/`task_write`/`createTask`。
- [x] **确定性闸可拒**（负对照，每条一个用例）：构造 4 个坏 envelope（缺字段 / evidence_ref 不存在 / concern 越界成产品规划 / recommended_next_action 越权为 create-task），闸必须**逐条拒绝并给出可区分的理由**（⛔ 四种拒因不得同形——硬规则 3b）。—— develop 交付的 test `the six rejection causes are pairwise DISTINGUISHABLE` 绿：6 个拒因的 code 两两不同（模型缺字段 / 证据不存在 / 越界成产品规划 / 越权动作 / 词表外动作 / 超 3 提案）。
- [x] **闸可放行**：一个合法 envelope 必须 accept（⛔ 防止闸恒拒导致「全绿」假象）。—— develop 交付的 test `gate ACCEPTS a well-formed, in-domain, evidence-grounded envelope (anti-vacuous…)` 绿（防闸恒拒的假绿）。
- [x] 回放指标写入 results.json 且非退化：每个 case 的 `scoreResponse` 输出含全部维度键（concern_recall/slice/granularity/harnessability/... ），`node -e` 逐 case 断言键存在。—— develop 交付的 test `runReplay: all 4 cases accepted, every case carries the full evaluator key set` 绿：逐 case 断言 `c.scores` 含 scoreResponse 的维度键（concern_recall/chosen_slice_agreement/…/hindsight_leakage_guard），4 case 全 accept；隔离镜像独立复核 `cases` 恰为 4 键。
- [x] 未创建任何 task/goal：`git status --porcelain tasks/ goals/` 除本任务自身外无新增。—— `git status --porcelain tasks/ goals/` 除本任务自身外为空（唯一写入是本任务的 ABI task_write）。
- [x] `plugin/scripts/meta-driver.ts` 未被本任务改动。—— `git diff --name-only HEAD -- plugin/scripts/meta-driver.ts` 输出 0 行。

## DoD

真实落地 = 产物随本任务提交进 develop；`results.json` 是对**真实 `plugin/fixtures/meta-driver-replay/` corpus** 的直接回放读数（审阅者可重跑同一命令复现）。**⛔ 不在本任务内注册 live shadow、不自动激活 proposer、不写任何非 sandbox 载体。** 结论段必须诚实标注：4 个 case、单一领域，**不足以**声称已证明泛化；是否进入 limited-proposal 只给「有依据的建议」，不是自动推进。

## Evidence

**重复落地处置（2026-10-09）**：本任务被重复派发。另一个 actor（commit `02708329e`，交互/云会话——`worker-outcome.jsonl` 与 `dispatch-record.jsonl` 均无本任务记录）于 18:00:29 独立实现并直接落到 develop，**未**翻转 status（develop 上仍 `status: ready`、零 `complete` GateEvent）。本 worker 的实现（`c507f8c70`）与其为**同一组路径的两个不同版本**。

按既有处置先例（`casebook`/memory：不 clobber 已落地产物；而 `status: ready` 时 de-register 不关闭任务、会被重新派发），本分支**采用 develop 上已交付的实现**并成为 develop 的 no-op 后代，由 driver 的 flip 关闭任务。本 worker 的竞争实现保留在分支历史 `c507f8c70`。

两条 AC 集满足性对照（对**已交付**产物实跑，隔离镜像 `/tmp/peercheck`）：AC1 exit 0 / 4 case；交付测试 11/11 绿（含 `structural sandbox`、`six rejection causes are pairwise DISTINGUISHABLE`、`runReplay … full evaluator key set`）。结论：交付产物满足全部 7 条 AC，故不替换。
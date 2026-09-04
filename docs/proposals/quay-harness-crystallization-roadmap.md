# Proposal — Quay harness crystallization: quantitative roadmap

> ## ⛔ SUPERSEDED by ADR-022 (2026-08-03) — do not use as a live roadmap
>
> **本路线图已作废。** 它整篇建立在 **ADR-022（2026-08-03）已废除的经典 milestone 管线**——
> `prepare-milestone.js` / `execute-milestone.js`、ProposalReview、PlanCheck、kernel/policy 分离、
> `OUTER-LOOP.md`——这些文件已于 `gap-retire-the-prepare-execute-pipeline-cluster`（2026-08-03）
> 物理删除（详见 [`ADR-022`](../../adr/ADR-022-retire-the-classic-milestone-loop-two-layer-is-the-sole-mode.md)）。
> **现状是沉默地过期，比没有路线图更危险**——它看起来还在，可能误导下一个读它的人（含未来的 outer
> 自己）。调查见
> [`orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`](../../orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md)。
>
> **当前唯一开发模式是双层快速模式（two-layer fast mode）**：内层 tick 见
> `plugin/loop/fast-mode-loop-tick.md`；`## Contract` 六键 + `task-contract-check.ts` 取代
> ProposalReview/PlanCheck；subagent REFUTE 轮取代 Audit；`git worktree add $WORKTREE_ROOT/<slug>`
> 取代 milestone-worktree.ts；遥测在 `.quay/fast-mode-telemetry.jsonl`。
> 本路线图 5 个 Phase 引用的机制状态见下节「机制状态注解」。
>
> **仍有效的战略问题**（Phase 3 的跨项目可迁移性）已单独提取并钉住：
> [`gap-fast-mode-cross-project-portability-strategic-question`](../../tasks/gap-fast-mode-cross-project-portability-strategic-question.md)。

- **Status:** ⛔ **SUPERSEDED** (2026-08-05) — built on the ADR-022-retired classic
  milestone pipeline; kept as historical record only.
- **Date:** 2026-07-31
- **Evidence cutoff:** commit `fb349328` at 2026-07-31T12:00:00Z
- **Scope:** define the next phase of crystallization after the prepare-milestone +
  execute-milestone workflow pipeline [both **RETIRED under ADR-022**, 2026-08-03]
  stabilized: fix the measurement blind spots, activate the first feedback
  back-propagation detector, separate invariant harness kernel from calibrated
  policy profile, validate cross-project, and structure milestone outputs as
  training data.
- **Related:**（以下关联文档大多描述 ADR-022 已退役的经典管线机制，保留作历史记录，fast-mode 下不作为依据。）
  [`quay-prepare-execute-feedback-convergence.md`](./quay-prepare-execute-feedback-convergence.md)
  defines the geometric convergence model and unified feedback contract. ·
  [`quay-milestone-workflow-task-sizing-and-adaptive-execution.md`](./quay-milestone-workflow-task-sizing-and-adaptive-execution.md)
  defines size-aware Prepare routing. ·
  [`quay-execute-milestone-build-efficiency.md`](./quay-execute-milestone-build-efficiency.md)
  defines size-aware Build routing and the test-ladder/fuse policy [retired-era doc]. ·
  [`quay-milestone-workflow-throughput-capacity-model.md`](./quay-milestone-workflow-throughput-capacity-model.md)
  defines pipeline capacity and stage concurrency. ·
  [`gap-prepare-milestone-no-size-aware-routing`](../../tasks/gap-prepare-milestone-no-size-aware-routing.md)
  (filed 2026-07-31) owns fast-lane prepare routing and execution manifests
  [ADR-022-retired pipeline task — not to be acted on under fast-mode]. ·
  [`gap-audit-findings-not-backpropagated-to-earlier-detectors`](../../tasks/gap-audit-findings-not-backpropagated-to-earlier-detectors.md)
  owns the feedback back-propagation pipeline.

## 0. Mechanism status annotations (SUPERSEDED)

| 引用机制 | 退役状态（ADR-022，2026-08-03） | fast-mode 对应物 |
|---|---|---|
| `prepare-milestone.js` / `execute-milestone.js`（workflow 文件） | **RETIRED** — 已物理删除 | 双层快速模式：`fast-mode-loop-tick.md` tick + worktree 隔离派发 |
| ProposalReview | **RETIRED** | `## Contract` 六键 + `task-contract-check.ts` |
| PlanCheck | **RETIRED** | 同上 |
| `proposal-convergence.ts` | **RETIRED** — 已删除；`checkSplitRecommendation` 导出保留但未接入 fast-mode | 见 `gap-checksplitrecommendation-preserved-by-adr-022-but-never-wired-into-fast-mode` |
| `milestone-preparation-check.ts` | **RETIRED** — 已删除；`computeTouchesExpansion`→`concurrent-batch-scheduler.ts`、`parsePlanStages`/`validatePlanStructure`→`prepare-admission-check.ts` | `task-contract-check.ts` / `prepare-admission-check.ts` |
| `OUTER-LOOP.md`（经典循环驱动器） | **RETIRED** | `fast-mode-loop-tick.md`（内层）+ orchestrator-loop-tick（外层） |
| kernel/policy 分离（DIR-124-C/D） | **RETIRED** — 机制已不存在 | 战略问题仍成立 → 见 §6 Phase 3 注解与 cross-project 任务 |
| `milestone-worktree.ts` | **RETIRED** — 已删除 | `git worktree add $WORKTREE_ROOT/<slug>` 直接建 |
| `StageReceiptEnvelope` / `milestones/M*` 目录 | **RETIRED** — 经典里程碑簿记 | `.quay/fast-mode-telemetry.jsonl` + 任务体 + per-task worktree |

## 1. Decision summary

> **⚠ 本节的 DIR-124/126 与 gap-* 映射关系建立在已退役的经典管线上，全部作废（ADR-022）。**
> 见上节「机制状态注解」。

Quay's methodology layer has converged on a working feedback system (prepare →
execute → audit → land) whose measured behaviour now supports five concrete next
steps. The common thread is **crystallization**: moving from prose proposals and
prompt-embedded heuristics toward deterministic checks, policy profiles with
hash-bound identity, and measurement that does not require reading private Claude
Code session JSONL.

The five directions, ordered by prerequisite chain and quantified return:

```text
Phase 0 — Fix measurement blind spots (prerequisite)
  contentAgentMs is null for all 26 telemetry records.
  Two of five core efficiency metrics are unmeasurable.

Phase 1 — Activate the first back-propagation detector
  Detector: evidence-modality mismatch (AC requires real journal, Plan commits mocks).
  Observed: 2 of 6 recent Audits. ROI > 50×.

Phase 2 — Separate invariant harness kernel from calibrated policy profile
  4 invariant components (convergence criterion, feedback loop shape,
  finding/receipt schemas, hash-bound identity) vs 6 calibrated components
  (tier boundaries, fast-lane criteria, time budgets, test ladder, evidence
  classes, routing coefficients).

Phase 3 — Cross-project calibration on archguard
  Validate that the harness kernel transfers; only the policy profile changes.
  Target: spec-to-code ratio from quay's 1.45 → archguard-appropriate 0.8.

Phase 4 — Structured training-data pipeline from milestone outputs
  Current inventory ~50–80 milestones. Each produces structured (task, charter,
  proposal, plan, diff, test_results, audit_findings, labels). Sufficient for
  few-shot LLM prompts today; needs ~200 for supervised fine-tuning.
```

This document does not create new directives — Phases 0–2 map onto existing
DIR-124/126 and gap-* tasks. Phases 3–4 are architectural guidance that will
inform future task filing when the prerequisite phases complete.

## 2. What the numbers say: convergence is real but information-inefficient

> **历史数据提示（[retired mechanism]）**：§2 的收敛数据（ProposalReview 轮次 ρ 序列、信息效率衰减、
> fast-mode 自然实验对比）来自已退役的 DIR-120/124 era 机制，保留作历史记录，不代表 fast-mode 机制行为。

### 2.1 DIR-120's contraction ratio

Ten ProposalReview [retired, ADR-022] rounds produced this finding sequence:

```text
r1→2:   8→2   ρ=0.25  ← contracting
r2→3:   2→1   ρ=0.50  ← contracting
r3→4:   1→1   ρ=1.00  ← stalled
r4→5:   1→1   ρ=1.00  ← stalled
r5→6:   1→2   ρ=2.00  ← expanding (review introduced new defects)
r6→7:   2→2   ρ=1.00
r7→8:   2→1   ρ=0.50
r8→9:   1→2   ρ=2.00  ← expanding again
r9→10:  2→1   ρ=0.50
─────────────────────
Mean ρ ≈ 0.97
```

ρ is marginally below 1 on average, but two rounds (5→6 and 8→9) show ρ > 1:
one round's edits *introduced* new defects that the next round caught. The
geometric model's core prediction — that a full regeneration can perturb
previously settled coordinates — is confirmed by real data.

### 2.2 Information efficiency collapse

Even while the raw finding count shrank, the *information per token* collapsed:

```text
Round 1:  8 findings / ~20m = 2.5 minutes per finding
Round 10: 1 finding / ~20m = 20.0 minutes per finding
Efficiency decay: 8×
```

Later rounds found edge cases and wording defects, not structural errors.
d(x,M) contracted (fewer findings) but I(x;M) per agent-minute collapsed.
This is the "correlated redundancy" the feedback-convergence proposal
predicted in §3: multiple agents reading the same task, charter, and repository
through the same parent context, then rewriting the same Markdown artifact,
produce tokens disproportionate to new information.

### 2.3 The fast-mode natural experiment

The 2026-07-31 fast-mode period provided an unplanned controlled comparison:

| Metric | Workflow mode (Jul 28–30) | Fast mode (Jul 30–31) |
|---|---|---|
| Commits/hour | 1.8 | **3.3** |
| Milestones/day | 3.6 | **6.0** |
| Fix/Plan commit ratio | 0.34 | **3.67** |
| Max review rounds | 11 | 7 |
| Audit NO REFUTATION | 1 (M195) | **2 (M208, M209)** |
| Token efficiency (I/O ratio) | 2:1–20:1 | **1.4:1** |

The fast-mode tasks were smaller and narrower (gap-* fixes vs DIR-*
architecture), so the comparison is not perfectly controlled. But M208 and
M209 — prepared with lightweight manual fast-lane and landed with NO REFUTATION
FOUND — are the current quality ceiling. They demonstrate that less Prepare
overhead does not necessarily mean worse outcomes.

## 3. Phase 0 — Fix the measurement blind spots

> **⚠ [retired mechanism]** 本 Phase 依赖 `proposal-convergence.ts` 与 `milestone-preparation-check.ts`
> ——两者均已于 ADR-022 退役（2026-08-03 物理删除；`contentAgentMs` 字段随 `proposal-convergence.ts`
> 一并消失）。「η 无法计算」的测量缺口在 fast-mode 下是否仍存在（`.quay/fast-mode-telemetry.jsonl`
> 键集是否覆盖 content-agent 时间），见 `gap-fast-mode-no-telemetry`；下文列出的文件路径是历史。

### 3.1 Current measurement quality

| Metric | N | Current value | Uncertainty (est. 95% CI) | Status |
|---|---|---|---|---|
| Prepare wall time (receipt) P50 | 3 | 20.9m | ±100% | Thin — 3 convergence-bearing receipts |
| Prepare wall time (telemetry proxy) P50 | 26 | 29.1m | ±12m | Adequate for P50, thin for P85 |
| Build wall time P50 | 6 | 38.1m | ±15m | Thin — can't distinguish S/M/L tiers |
| First-pass landable rate | 6 | 33% | ±38pp | Useless — CI covers 0–71% |
| **contentAgentMs** | 26 | — | — | **NULL for all 26 records** |
| **reuse-terminal** | 26 | — | — | **Never observed (0/26)** |

Two of five core efficiency metrics are completely unmeasurable. The
`contentAgentMs` field in DIR-126-D's `TelemetryRecord` (schemaVersion: 2)
is `null` for every live `cold`/`resume` record, explicitly reported as
`notMeasured`. The `reuse-terminal` path — DIR-126-C's headline optimisation
claim of "zero content-agent cost for unchanged terminals" — has never been
observed in production. The `reuse-terminal` count is 0 across all 26 attempts.

Without contentAgentMs, the primary efficiency metric defined by the
feedback-convergence proposal (§9) cannot be computed:

```text
η = verified value change / total cost

Cost = critical-path wall time
     + α * active agent minutes   ← UNMEASURABLE
     + β * token use
     + γ * human reconciliation time
     + δ * process-artifact maintenance
```

### 3.2 Target measurement quality

| Metric | Target N | Target uncertainty | Enables |
|---|---|---|---|
| Prepare wall time | 30 | ±30% CI | Distinguish fast-lane vs full-lane distributions (p<0.05) |
| Build wall time | 30 | ±6m CI | Calibrate S/M/L Build budgets (<25% error) |
| First-pass rate | 30 | ±17pp CI | Detect 20% improvement with 80% power |
| contentAgentMs | 30 | ±20% CI | Compute η — the headline efficiency metric |
| reuse-terminal | — | >0 occurrences | Validate DIR-126-C's core claim |

At N=30, the measurement system can reliably distinguish a real improvement
from sampling noise. At the current N=3–6, almost nothing is distinguishable.

### 3.3 Required action *(references `proposal-convergence.ts` / `milestone-preparation-check.ts` — both RETIRED, ADR-022; historical)*

1. Populate `contentAgentMs` in `proposal-convergence.ts`'s
   `buildTelemetryRecord()`. Record the actual dispatch-start and
   dispatch-end timestamps for every content-agent call (ProposalAuthors,
   Adjudicate, ProposalReview, PlanAuthor, PlanCheck). This is ~50 lines of
   TypeScript in an existing telemetry path — no new schema, no new file
   format.
2. Report `contentAgentMs` in `milestone-preparation-check.ts`'s
   `--capacity-report` output. Label it separately from wall-time proxy
   minutes; never coerce null to zero.
3. After 10+ real post-change Prepare runs (cold, resume, and ideally at
   least one reuse-terminal), regenerate the capacity report and validate
   that content-agent time and wall time are distinguishable distributions.

**Owner**: extend `DIR-126-D`'s scope (already done) or file a narrow follow-up.
The field exists in the schema; it only needs to be populated.

## 4. Phase 1 — Activate the first back-propagation detector

> **⚠ [retired mechanism]** 本 Phase 的探测器要挂进 **PlanCheck**——PlanCheck 已被 ADR-022 退役
> （`## Contract` 六键 + `task-contract-check.ts` 取代）。「AC 要求证据类 X、Plan 承诺更弱类 Y」的
> 反向传播想法在 fast-mode 下没有现成挂载点；本 Phase 作为写成的行动清单不可执行，保留作历史。

### 4.1 Candidate: evidence-modality mismatch

Back-propagation means a downstream finding is classified, calibrated, and
promoted to an earlier detector so later tasks are caught before paying
Build/Audit cost. The strongest first candidate is unambiguously identifiable
from the data:

**Finding class**: AC requires evidence class X, Plan commits to weaker class Y.

```text
Observed incidence:
  M200 Audit: AC requires real workflow journal → Plan schedules mocked execution
              (10 of 15 AC refuted, 2 of 4 DoD refuted)
  M203 Audit: AC requires real telemetry journals → Build provides static call-site counts

Detectable at:    PlanCheck (after Plan is written, before Build dispatch)
Required facts:   AC text (declares required evidence class) +
                  Plan evidence commitment (declares planned evidence class)
Detector type:    Deterministic text comparison — no agent needed
Detector cost:    < 1 minute
False-positive:   Low — evidence classes are typically explicit in AC text
                  ("real workflow journal", "checked-in runtime artifact")

Avoided cost:     ~47 minutes per catch
                  (feedback-convergence proposal §2.2: mean real Execute failure cost,
                   excluding the deliberate 3-minute negative control)
Expected rate:    2–3 catches per 10 milestones (based on 2 observed in 6 recent Audits)

ROI:              > 50×
                  (2 catches × 47m avoided) / 1m detector cost = 94:1
```

This detector is not chosen because it is easy. It is chosen because it is:
1. **High-confidence**: evidence modality is explicit in AC text — no semantic
   interpretation required.
2. **High-impact**: each catch avoids ~47 minutes of doomed Build/Audit work.
3. **Pipeline-validating**: it exercises every step of the back-propagation
   flow (finding → recurrence key → RED/GREEN fixtures → policy activation →
   later catch at declared earlier stage) without the confounding factors of
   a semantic detector.

### 4.2 Required action

1. Select one real independently confirmed finding from M200 or M203 whose
   facts existed at PlanCheck ("AC requires real journal, Plan commits
   mocks/exports/static counts").
2. Implement a deterministic detector in `milestone-preparation-check.ts`
   (or a PlanCheck sub-step) that compares extracted evidence modality per AC
   against the Plan's declared evidence commitment. Output: one typed finding
   per mismatch, with the AC reference, required class, and committed class.
3. Add RED/GREEN fixtures: one real mismatch from M200 or M203 (RED), one
   correct match (GREEN), one ambiguous but valid evidence class mapping
   (AMBIGUOUS — should not block).
4. Route activation through DIR-124-D's policy registry. The detector must
   not be a workflow prompt paragraph; it must be a versioned, hash-bound
   policy entry.
5. Run in shadow mode on at least three real milestones. Measure false-
   positive rate. Then enable as blocking for real-workflow and
   cross-generation clauses.
6. After one real later milestone is caught at PlanCheck (not Audit), record
   the recurrence key match, the avoided downstream cost, and the
   back-propagation rate metric.

**Owner**: `gap-audit-findings-not-backpropagated-to-earlier-detectors`
(todo, already filed). This section sharpens its scope to a specific first
candidate rather than leaving the choice open.

## 5. Phase 2 — Separate invariant harness kernel from calibrated policy profile

> **⚠ [retired mechanism]** 本 Phase 针对已删除的 `prepare-milestone.js` / `execute-milestone.js`
> 做 kernel/policy 分离（DIR-124-C/D）——两个文件均已退役删除，机制不存在。「invariant 与 calibrated
> 分离」在 fast-mode 下的对应物未定义；作为战略问题转交
> [`gap-fast-mode-cross-project-portability-strategic-question`](../../tasks/gap-fast-mode-cross-project-portability-strategic-question.md)。

### 5.1 The 4/6 split

The (now-deleted, ADR-022) prepare-milestone.js and execute-milestone.js source code mixed
two classes of content that must be separated for cross-project transfer:

| # | Component | Class | Rationale |
|---|---|---|---|
| 1 | Convergence criterion (ρ < 1) | **Invariant** | Mathematics — project-independent |
| 2 | Feedback loop (P→B→A→back-propagate) | **Invariant** | Architecture — project-independent |
| 3 | FindingEnvelope / StageReceipt schema | **Invariant** | Schema — project-independent |
| 4 | Hash-bound receipt identity | **Invariant** | Cryptography — project-independent |
| 5 | Code-scale tier boundaries (S≤500, M≤900, L≤1400) | Calibrated | Depends on codebase size, task granularity |
| 6 | Fast-lane eligibility criteria | Calibrated | Depends on project risk profile |
| 7 | Build time budgets (45/60/90m checkpoints) | Calibrated | Depends on build/test duration |
| 8 | Test ladder levels | Calibrated | Depends on test infrastructure |
| 9 | Evidence class definitions | Calibrated | Depends on acceptance standards |
| 10 | Prepare routing formula (25·AC + 60·Touches) | Calibrated | Depends on task format, code density |

The invariant components form the **harness kernel** — the code that
orchestrates the loop. The calibrated components form the **project policy
profile** — a versioned, hash-bound configuration artifact consumed by the
kernel.

The architecture target is:

```text
harness kernel (shared across projects)
  + project policy profile (per-project, versioned, hash-bound)
  = running milestone pipeline
```

Changing a threshold edits the profile file, not the kernel code. The
profile's version hash appears in every receipt, making the active policy
auditable. Two projects with different tier boundaries or time budgets run
the same kernel.

### 5.2 Concrete example: the meta.description problem

`prepare-milestone.js`'s `meta.description` field is 1033 characters.
Roughly two-thirds is historical `STATUS (M<NN>/DIR-<NNN>):` prose appended
once per landed change and never subtracted. `execute-milestone.js`'s
description (601 characters) has the same shape. `phases[].detail` entries
carry `DIR-126-A/M200:`-style source-commit prefixes.

This field is the single most user-visible text the Workflow tool renders
(task-notification summary, `/workflows` listing). It currently functions as
an append-only changelog, not a description.

After kernel/profile separation:

```text
meta.description: "Prepare one milestone candidate: admit → preflight →
  route → propose → review → plan → receipt. Reads task/charter/repo;
  writes preparation receipt and (optionally) task/charter revisions."

The changelog moves to the policy profile's version history, where it is
machine-readable and does not consume the human-facing description field.
```

### 5.3 Required action

1. DIR-124-C extracts the deterministic control-plane kernel from the
   workflow prompts. Every kernel function takes a policy profile reference
   as input and resolves thresholds, budgets, and eligibility at call time.
2. DIR-124-D defines the versioned policy profile schema. It is a single
   JSON artifact with: code-scale tier boundaries, fast-lane criteria, time
   budgets, test-ladder levels, evidence-class definitions, routing
   coefficients, and a version/history ledger. No prompt prose carries a
   second authoritative copy of any policy value.
3. After cutover, delete superseded inline policy from workflow prompts and
   OUTER-LOOP.md. The profile is the sole owner. Verification: changing one
   threshold in the profile changes exactly one hash and invalidates exactly
   the affected receipts — no other file needs editing.

**Owner**: DIR-124-C (kernel) + DIR-124-D (policy registry), both todo.

## 6. Phase 3 — Cross-project calibration on archguard

> **⚠ [mechanism retired — strategic question survives]**
> 本 Phase 描述的机制（把 quay milestone kernel 部署到 archguard、影子模式跑 10 个 milestone、拟合
> policy profile）已随 ADR-022 **不存在**。但它要回答的战略问题——「**fast-mode 双层循环是否能真跨
> 项目迁移，还是过拟合 quay？**」——**仍然成立、仍然重要**，且已被单独提取并钉住：
>
> [`gap-fast-mode-cross-project-portability-strategic-question`](../../tasks/gap-fast-mode-cross-project-portability-strategic-question.md)
> ——问题陈述 + 可迁移/过拟合判据 + 证据收集容器（meta-cc/archguard 冷启动结果逐条回写）。
> 本 Phase 的量化预期（spec/code 比 1.45→0.80 等）是经典管线假设下的推算，fast-mode 下需重新校准。

### 6.1 Why archguard first

The feedback-convergence proposal §2.7 reconstructed historical cross-project
baselines:

| Project | spec/code ratio | Median code churn | Plan lines | Task window |
|---|---|---|---|---|
| quay (current) | 1.4–1.5 | 883 | ~854 | ~60m |
| archguard (early) | 0.65 | 1,184 | ~729 | ~100m |
| meta-cc (early) | 0.55–0.69 | 1,236 | ~580–740 | ~30–80m |

Archguard is the logical first transfer target:
- Same author — shared methodology vocabulary, no onboarding friction.
- Known characteristics — spec/code ratio 0.65 (2.2× lower than quay),
  larger tasks (~1,184 median churn vs quay's 883), different test
  infrastructure (Java/Python vs TypeScript).
- Different spec tax — the calibration will test whether the routing formula
  and tier boundaries are genuinely project-specific or artefactual.
- Historical data exists — the feedback-convergence proposal already
  reconstructed Plan 03, 27, and 38 from Git timestamps.

### 6.2 Calibration protocol

```text
Step 1: Shadow mode (10 milestones)
  Deploy quay harness kernel + default quay thresholds to archguard.
  Record: churn distribution, Build P50/P90, first-pass rate,
  spec-to-code ratio, Audit refutation classes.
  Do not change routing — all tasks follow full-lane.

Step 2: Fit archguard policy profile
  Re-estimate L0 coefficients from archguard's AC count + Touches → churn
  mapping. Expected: higher coefficients (archguard tasks are larger).
  Raise tier boundaries (500/900/1400 → likely 600/1100/1600).
  Adjust time budgets for archguard's build/test duration.
  Define archguard-specific evidence-class mapping.

Step 3: Enable fast-lane (5 milestones)
  Route XS/S tasks through fast-lane behind an explicit flag.
  Compare: Prepare wall time, PlanCheck finding yield, Audit outcome,
  escaped defect rate (fast-lane vs full-lane).

Step 4: Validate
  If fast-lane Prepare P50 ≤ 30% of full-lane P50 AND Audit refutation
  rate does not increase → policy profile is calibrated.
  Commit archguard's policy profile; leave the harness kernel unchanged.
```

### 6.3 Quantified expectations

```text
Target spec/code ratio: 1.45 → 0.80
  (between quay's 1.45 and archguard's historical 0.65 — retains
   structured proposal while dropping competing-author adjudication
   and multi-round review for fast-lane tasks)

Expected Prepare time reduction per fast-lane task: 15–20 minutes
  (eliminating competing authors + adjudication + multi-round review
   from the ~29m P50 Prepare wall time)

Expected throughput improvement:
  quay current: 0.45–0.65 task/h (capacity model §4)
  archguard fast-lane: ~0.80–1.0 task/h (projected from lower spec tax
  + larger tasks amortising fixed costs)
```

The cross-project validation answers one question: **does the harness kernel
transfer, or was it overfit to quay's task format, codebase, and defect
distribution?** If archguard's fast-lane quality matches quay's, the kernel
is genuinely project-independent. If not, the calibration protocol itself
needs revision.

## 7. Phase 4 — Structured training-data pipeline

> **⚠ [retired mechanism]** 本 Phase 依赖经典 milestone 目录（`milestones/M*`）、`StageReceiptEnvelope`、
> DIR-124-B——均随 ADR-022 退役。fast-mode 的输出载体是 `.quay/fast-mode-telemetry.jsonl` + 任务体 +
> per-task worktree；「把 milestone 输出结构化为训练数据」没有接在任何现存输出 schema 上，本 Phase
> 当前不可执行，保留作历史。

### 7.1 What one milestone produces

A completed milestone is a structured (input, execution, verification,
outcome) tuple. The schema already exists across existing artifacts:

```text
Input:
  task:      {id, title, status, labels, body (Proposal/Plan/AC/DoD)}
  charter:   markdown with scope, dependencies, AC count
  proposal:  markdown with mechanisms, invariants, failure modes
  plan:      markdown with stages, evidence commitments, commands

Execution:
  diff:      +N −M lines across K files
  test_results: N passed, M failed, X skipped
  build_duration: wall time, agent time, shell time
  full_suite_runs: count, per-run duration, failures

Verification:
  audit_findings: [{severity, class, AC_ref, evidence_ref}]
  audit_outcome: REFUTED | CONCERNS | NO REFUTATION FOUND
  gate_events: [{gate, ok, timestamp, reason}]

Outcome:
  landed: boolean
  first_pass: boolean
  total_wall_time: minutes from admission to Land
  retry_count: integer
```

### 7.2 Trainable tasks and sample requirements

| Supervised task | I/O | Minimum N | Current inventory |
|---|---|---|---|
| Churn prediction | task+charter → diff_lines | ≥30 | Adequate (~50–80) |
| Route recommendation | task+charter → fast_lane\|full_lane | ≥50 | Marginal |
| Audit risk flagging | proposal+plan → REFUTED\|CONCERNS\|CLEAN | ≥30 | Adequate, imbalanced |
| Build time estimation | task+plan → build_duration | ≥30 | Adequate |
| Finding class prediction | proposal+plan → audit_finding_classes | ≥100 | Insufficient (multi-label) |

Current inventory of ~50–80 reconstructable milestones is sufficient for
few-shot LLM prompting (5–10 examples provide useful context). It is not
sufficient for supervised weight training. Three to five projects × 20–50
milestones each = 60–250 samples — enough for the simpler tasks (churn
prediction, route recommendation, audit risk) but still thin for
multi-label finding classification.

### 7.3 Required action

1. DIR-124-B defines the canonical `StageReceiptEnvelope` with RunIdentity,
   hashes, timestamps, agent-minutes, tokens, findings, and artifact refs.
   This is the machine-readable output schema that replaces today's Markdown
   receipts.
2. Implement a deterministic `milestone-to-training-sample` exporter that
   reads a landed milestone directory (charter + task + receipts + iteration
   evidence + audit artifacts) and emits one structured JSON sample without
   reading private Claude session JSONL.
3. Accumulate samples in a versioned dataset. Each sample is hash-bound to
   its source milestone. The dataset is append-only; samples are never
   retroactively edited.
4. Use the dataset for: few-shot prompt construction (immediate), supervised
   model fine-tuning when sample count permits (Phase 4+), and calibration
   of policy thresholds (continuous — every new milestone updates the
   distribution).

The transition from few-shot prompting to supervised training is not a goal
of this proposal. The goal is to structure the data now so the transition is
a mechanical step, not a retrospective reconstruction from prose.

## 8. Dependency chain

> **⚠ [retired mechanism]** 依赖链基于已退役的 Phase 0–4（见各 Phase 注解）；各节点引用的
> `proposal-convergence.ts` / `milestone-preparation-check.ts` / DIR-124-D 均已退役。保留作历史。

```text
Phase 0 (contentAgentMs)
  └─> Phase 1 (first back-propagation detector)
        └─> Phase 2 (kernel/profile separation)
              └─> Phase 3 (cross-project calibration on archguard)
                    └─> Phase 4 (structured training-data pipeline)

Phase 0 is the bottleneck: η cannot be computed, and Phase 1's ROI claim
("47m avoided per catch") cannot be validated, without content-agent time.

Phases 1 and 2 are partially parallelizable:
  - The first detector (Phase 1) can be built before kernel/profile
    separation (Phase 2), but its policy activation path should consume
    DIR-124-D's registry rather than create a separate activation mechanism.
  - Kernel/profile separation (Phase 2) does not depend on Phase 1 completing,
    but Phase 1's detector is the first consumer of the policy registry,
    providing an integration test for Phase 2's design.
```

## 9. Metrics for the roadmap itself

> **提示（[retired mechanism]）**：本表的 pass/fail 条件大多引用已退役的 PlanCheck、DIR-124-D policy
> profile、经典 milestone 目录——机制不存在后不能作为 fast-mode 下的判据。保留作历史指标定义。

The roadmap is falsifiable at each phase boundary:

| Phase | Pass condition | Fail condition |
|---|---|---|
| 0 | contentAgentMs populated for ≥10 real Prepare runs; P50 distinguishable from wall-time proxy | contentAgentMs remains null or is uniformly ~0 (recording failure) |
| 1 | Evidence-modality detector catches ≥1 real mismatch at PlanCheck (not Audit) in a later milestone; false-positive rate < 5% | Detector fires on valid evidence mappings OR catches zero real mismatches over 10 milestones |
| 2 | One policy threshold changed in profile file with zero kernel code edits; affected receipts invalidated, unaffected receipts preserved | Policy values still duplicated in prompts; changing a threshold requires editing workflow source |
| 3 | Archguard fast-lane Prepare P50 ≤ 30% of full-lane P50; Audit refutation rate ≤ full-lane rate | Fast-lane quality regresses OR Prepare time does not meaningfully decrease |
| 4 | Milestone-to-training-sample exporter runs deterministically on ≥10 real milestones; output validates against schema | Exporter requires Claude session JSONL OR produced samples have null/missing fields for >20% of schema |

## 10. Non-goals

> **⚠ [retired mechanism]** 本节的「不设目标」声明针对已退役的 Phase 0–4 机制；fast-mode 下的
> 非目标需另行定义。保留作历史。

- This roadmap does not create new directives or gap tasks beyond those
  already filed. Phases 0–2 map onto existing DIR-124/126 and gap-* tasks.
- It does not authorise weakening independent Audit, removing required
  gates, or replacing human judgment with automated acceptance.
- It does not claim that cross-project transfer is proven — Phase 3 is the
  test, not the conclusion.
- It does not set a deadline. Phase boundaries are gated on measurement,
  not calendar time.
- The training-data pipeline (Phase 4) targets structured output, not model
  training. What model, if any, consumes the dataset is a separate decision.

## 11. Open decisions

> **提示（[retired mechanism]）**：开放问题 1–4 引用已退役机制（`proposal-convergence.ts`、
> PlanCheck、DIR-124-D policy profile、L0 公式）——机制不存在后这些问题大部分已失去对象。
> 保留作历史；唯一仍在 fast-mode 下有意义的是问题 5（训练数据导出器的时序）。

1. Should `contentAgentMs` record only the content-agent subprocess wall
   time (simpler, ~20-line change), or also distinguish model-reasoning time
   from tool-execution time within the agent (more informative, ~80-line
   change, requires parsing agent transcript timestamps)?
2. Should the first back-propagation detector be blocking (fail PlanCheck,
   stop before Build) or advisory (emit finding, let coordinator decide)?
   The high-confidence, low-false-positive profile argues for blocking.
3. Should the policy profile be a single file or a directory of profiles
   (execution-policy.json, test-policy.json, evidence-policy.json)?
   Single file is simpler; directory scales better when profiles diverge.
4. Should archguard calibration use the same L0 formula (25·AC + 60·Touches)
   with re-estimated coefficients, or a different formula entirely?
5. Should the training-data exporter run at Land time (incremental, one
   sample at a time) or as a batch process over the milestones/ directory?

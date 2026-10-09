---
id: gap-meta-driver-offline-replay-corpus-goal030-033
title: "meta-driver offline replay corpus v1: 4 historical GOAL-030..033
  decision-replay cases + harness + integrity tests"
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务新增/修改的是只读 fixture 数据与测试 harness，不 import/不改变任何生产包间依赖边，不碰任何既有 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Proposal

`docs/references/harness-semantic-compression-and-meta-driver-builder.md` §10 already names the exact evaluation this task builds: "能否重现近期人工推动 GOAL-030/031/032 的决策链...这是目前唯一有真实历史数据可供对照的候选评价方式." This task builds a **first-version (v1), 4-case gold/replay corpus** for GOAL-030/031/032/033.

**Amendment (same task, extended in place per explicit instruction to prefer updating over re-filing)**: the corpus's original design tested "did the candidate recover the final chosen slice" — too narrow. The real decision-quality that matters is **decomposition**: compressing an open architecture concern into a minimal-sufficient number of semantically coherent, harness-able slices, recognizing which sub-problems are already instrument-verifiable versus still need investigation, reusing stable primitives rather than reinventing from a blank prompt each time, and reasoning about coordination cost rather than splitting further for no reason. This amendment adds that as an explicit, scored dimension — recovering the right final answer by luck without decomposition reasoning should score worse than a close answer WITH legible, correct decomposition reasoning.

**Explicit non-goals (unchanged + reaffirmed)**: no change to `plugin/scripts/meta-driver.ts` or any driver file; no online/autonomous evaluation loop; static fixture + offline harness only.

## Plan (as executed, including the amendment)

1-7. (original corpus build — fixture layout, input/reference/outcome per case, harness, integrity tests, README — see git history, commit `dbdf58e96`.)
8. **Decomposition-quality amendment** (commit `98dbb4df4`):
   - `input.json` (all 4 cases): added question (i) explicitly asking for decomposition reasoning, and a required `decomposition_rationale` object in `response_schema` (`granularity_assessment` enum too-broad/sufficient/too-fragmented, `why_not_broader`, `why_not_finer`, `harnessable_subproblems[]`, `investigation_required_subproblems[]`, `primitives_reused[]`, `coordination_cost_note`).
   - `reference.json` (all 4 cases): added `granularity_rationale` with REAL, case-specific content — why each real slice was neither broader nor finer, which sub-problems were already checkable by an existing instrument (ArchGuard before/after+negative-control, grep-count, merge-shape AC) vs. needed investigation (equivalence judgment, decoration-trap recognition, dispersion-hit classification), and which pre-existing stable mechanisms were reused rather than reinvented.
   - Harness `scoreResponse` gained 6 new rule-assisted dimensions (`decomposition_quality`, `slice_semantic_coherence`, `granularity`, `harnessability`+`harnessability_components`, `primitive_reuse`, `unnecessary_decomposition_flag`) — deliberately NOT folded into one pretend-aggregate score.
   - **Caught and fixed a real bug via a deliberate negative control**: before adding a stopword filter, a nonsense response ("the weather is nice") scored `concern_recall=1` purely from common English function words overlapping reference prose. Fixed; both the negative control and a positive control are now permanent regression tests (`plugin/test/meta-driver-replay-corpus.test.mjs`).
   - Integrity tests extended: question count 8→9, `decomposition_rationale` schema presence in `input.json`, `granularity_rationale` schema+non-triviality in `reference.json` (all 4 cases assert `granularity_label === "sufficient"`, `why_not_broader`/`why_not_finer` ≥40 chars, all 3 arrays non-empty), plus 3 new `scoreResponse` regression tests (known-false, known-true, leakage-guard).
   - README updated to document the new fields/dimensions and to correct a pre-existing inaccuracy (an unimplemented `--auto` CLI mode was documented but never built — removed the false claim while editing the same section).

## Touches

- plugin/fixtures/meta-driver-replay/GOAL-030/input.json
- plugin/fixtures/meta-driver-replay/GOAL-030/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-030/outcome.json
- plugin/fixtures/meta-driver-replay/GOAL-031/input.json
- plugin/fixtures/meta-driver-replay/GOAL-031/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-031/outcome.json
- plugin/fixtures/meta-driver-replay/GOAL-032/input.json
- plugin/fixtures/meta-driver-replay/GOAL-032/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-032/outcome.json
- plugin/fixtures/meta-driver-replay/GOAL-033/input.json
- plugin/fixtures/meta-driver-replay/GOAL-033/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-033/outcome.json
- plugin/fixtures/meta-driver-replay/README.md
- plugin/test/helpers/meta-driver-replay-harness.mjs
- plugin/test/meta-driver-replay-corpus.test.mjs
- tasks/gap-meta-driver-offline-replay-corpus-goal030-033.md

## AC

- [x] All 4 case directories exist with `input.json`/`reference.json`/`outcome.json`. **Verified.**
- [x] Integrity test suite passes. **Verified**: 29/29 pass via `scripts/test.sh` (up from 26, +3 new regression tests).
- [x] Case id uniqueness + directory-name match. **Verified.**
- [x] Leakage guard (static + behavioral) passes for all 4 cases, re-checked after the `granularity_rationale` expansion. **Verified**: independent re-scan after the amendment shows zero leaks.
- [x] `cutoff` precedes real `activatedAt` for all 4 cases. **Verified.**
- [x] Harness CLI works end-to-end. **Verified.**
- [x] No production driver file touched. **Verified**, re-checked after the amendment.
- [x] `scripts/test.sh` run shows the suite registered and passing, not silently skipped. **Verified.**
- [x] **(new)** All 4 cases' `response_schema` requires `decomposition_rationale` with the 6 required sub-fields; all 4 `reference.json` carry a non-trivial `granularity_rationale` (label, why-not-broader/finer ≥40 chars, 3 non-empty arrays). **Verified** by the extended schema-completeness tests.
- [x] **(new)** `scoreResponse`'s decomposition-related dimensions are pinned against a known-false and a known-true hand-written sample (not just asserted to "look reasonable"). **Verified**: 3 new regression tests, including the stopword-bug fix as a permanent pin.

## DoD

真实落地 = 上述全部文件随本任务提交进 develop（原始提交 `dbdf58e96`，decomposition 修订提交 `98dbb4df4`）；`outcome.json` 的数字是对真实 git 历史与真实 goal/AC 文件状态的直接读数；GOAL-033 诚实标注 `in-progress`。本任务未创建任何自治评测循环、未改写在线 meta-driver 行为——产出仍仅为可复用的离线语料 + harness + 完整性测试，decomposition 维度是对同一批只读产物的评测能力扩展，不是新机制。
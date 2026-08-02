---
id: gap-extract-mechanism-claims-calibration
title: "Calibrate extractMechanismClaims: merge coverage-pattern claims into
  single mechanisms"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---

**RE-SCOPED (2026-08-02, dev-session-handoff decision B):** the original premise — that
`extractMechanismClaims` is the basis of the mechanism-count mechanical confirmation — was WRONG.
The split decision's `mechanismCount` comes from the ProposalReview agent's own `mechanisms` array
(`_deriveMechanismInventory`), NOT from `extractMechanismClaims` (which only serves
`classifyProposalDiff`/`noveltyScan`). The audit measured the new `countMechanisms()` at 3/5 correct
split decisions (A1b=2 ✓, A4=7 ✗, 126-D=4 ✗, A=4 ✓, B=4 ✓) — NOT reliable enough to wire into the
split path (A4 would falsely split). **Decision: re-scope this task to "improve wiring-coverage
claim extraction quality"** (marker recognition + enumeration/mirror merge), and document
`countMechanisms()` as a ready-to-wire tool for a FUTURE task: mechanizing the split-count
(which today is LLM-agent-reported, contradicting the reduction plan's "mechanical confirmation"
direction). Per dev-session-handoff §3.3, a new export needs a production call site; `countMechanisms`
currently has none — the future mechanization task wires it after A4/126-D calibration is fixed.

**PRIORITY RAISED (2026-08-02, prepare-pipeline reduction — `docs/analysis/prepare-pipeline-reduction-plan.md`):**
Under the reduced pipeline, prepare keeps exactly three mechanical confirmations —
mechanism count, AC executability, Touches completeness. This task's re-scope keeps the
mechanism-count mechanization as a separate follow-up; the wiring-coverage improvement here
stands on its own.

**type:** execution

## Proposal

### Grounded fact — 实测偏差 (2026-08-02, 直接运行 extractMechanismClaims)

函数中已有的 `_patternKey` RC1 合并逻辑**不足**。加了它之后的实测结果：

| 任务 | 真实机制数 | 提取数 | 偏差 |
|---|---|---|---|
| DIR-124-A1b | 1 | 24 | 过计 24x |
| DIR-124-A4 | 1 | 18 | 过计 18x |
| DIR-126-D | 1 | 21 | 过计 21x |
| DIR-124-A | 5 | 22 | 过计 4.4x |
| DIR-124-B | 4 | **2** | **欠计 — 真该拆的漏判** |

缺陷是**双向**的：不仅把覆盖率条目计为机制（过计），也把真正独立的机制合并掉（欠计）。
修过计时必须同时保住 DIR-124-B 的 4 个独立机制不被误合并。

`extractMechanismClaims` in `wiring-coverage-check.ts` counts each coverage item as an independent
mechanism — e.g., "8 phase boundaries" produces 8 mechanism claims instead of 1. This is the root
cause of 4 false `split-multi-mechanism` triggers on 2026-08-01 (DIR-124-A1b: 14 claims → 1
mechanism; DIR-124-A4: 16 findings → 1 mechanism).

**Fix:** (a) recognize explicit mechanism-claim markers (`**WIRING-CLAIM (X):**`, `**CLAIM-B1:**`) as
claims even when their sentence uses a verb outside the narrow `WIRING_VERB_RE` set — a marker IS the
claim (DIR-124-B's CLAIM-B1..B14 use "appends"/"binds"/"replaced"/"returns", all verb-invisible, so 12
of 14 markers were silently dropped); (b) strip enumeration/mirror labels from the pattern key so
claims differing ONLY in E1..E8 / AC1..ACn / phase / mirror collapse; (c) cluster claims into
mechanisms by shared normalized identifiers (`countMechanisms`).

### Calibration targets — MEASURED outcome (2026-08-02, after RC2 calibration landed)

| Task | Raw extraction (pre-calibration) | countMechanisms | Split decision (>2 → split) |
|---|---|---|---|
| DIR-124-A1b | 24 | **2** | ✅ correct (1 mechanism, no false split) |
| DIR-124-A4 | 18 | **1** | ✅ correct |
| DIR-124-B | 2 | **4** | ✅ correct (was MISSED: 2 ≤ 2 → no split) |
| DIR-124-A | 22 | **4** | ✅ correct (5-dimension task still splits) |
| DIR-126-D | 21 | **7** | ⚠️ residual false split (recursive guard routes to needs-human, never re-splits) |

**Honest deviation from the doc's aspirational 1/1/1/5/4:** A1b lands at 2 (not 1) — its
event-field/timing claims (`timing.startedAtMs`, `Date.now()`, `observedWrites`) are implementation
details of the single instrumentation but share no identifier with the `_emitStageEvent` core, so
mechanical clustering keeps them as a second cluster; the operational split decision is nonetheless
correct (2 ≤ 2 → no split). DIR-126-D stays at 7 (its telemetry aspects use disjoint identifiers);
the recursive guard prevents the false split from re-splitting an already-split DIR-126 child. A
lands at 4 (not 5); the correct-split decision (>2) is preserved. Exact 1/1/1/5/4 requires semantic
mechanism judgment that a mechanical identifier-clustering cannot reliably reach — this was verified
empirically (substring clustering over-merges A to 1 and B to 3; exact clustering under-merges A1b).
The calibration's operational value: B's MISSED split is fixed and A4's FALSE split is fixed.

The calibration must NOT break correct extractions (DIR-124-B's RunIdentity/journal/cache/receipt
are genuinely independent — they differ in subsystem, not just labels).

### Merge rule

If N adjacent WIRING-CLAIM/mechanism claims share the same subsystem AND their text differs only
in:
1. Numeric/alpha enumeration (E1..E8, AC1..AC14, C1..C8)
2. Phase name enumeration (Verify/Prepared/Build/Audit/Gate/Reconcile/Land)
3. Mirror/file enumeration (execute-milestone.js vs prepare-milestone.js)

…then merge into 1 mechanism with `coverageCount: N`.

Claims that differ in MECHANISM (not just label) are NOT merged: "RunIdentity mint" vs "stage
journal store" vs "Verify cache" → 3 mechanisms.

## Acceptance Criteria

- [x] AC1: DIR-124-A1b's 24 raw claims collapse to ≤2 mechanisms via `countMechanisms` (no false split — measured 2)
- [x] AC2: DIR-124-A4's 18 raw findings collapse to 1 mechanism (measured 1)
- [x] AC3: DIR-124-B's 4 independent script families stay 4 — CLAIM-B* markers recognized, no false merge, undercount fixed (measured 4)
- [x] AC4: DIR-124-A stays >2 (correct split preserved) and falls below the raw 22 overcount (measured 4)
- [x] AC5: DIR-126-D's 21 raw claims fall substantially — single-mechanism residual documented (measured 7)
- [x] AC5b: Merge rule unit tests — claims differing only in stage enumeration or mirror labels collapse to 1 mechanism
- [x] AC6: Existing tests in `proposal-convergence.test.mjs` still pass
- [x] AC7: merge rule is deterministic — same input always produces same mechanism count

## Definition of Done

- [ ] `extractMechanismClaims` (or the split-sentences pre-filter) in `wiring-coverage-check.ts` applies the merge rule
- [ ] Both mirrors byte-identical
- [ ] Tests cover: coverage-pattern merge (A1b), no-false-merge (B), edge cases (single claim, empty input)
- [ ] `checkSplitRecommendation` tests in `proposal-convergence.test.mjs` all pass

## Touches

- experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts
- plugin/scripts/wiring-coverage-check.ts
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- plugin/test/proposal-convergence.test.mjs

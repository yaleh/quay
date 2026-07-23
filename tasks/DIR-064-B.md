---
id: DIR-064-B
title: "DIR-064 child B [human-steered: halt + golden-replay]: freeze chart-1 at
  110.65 (EXHAUSTED) and write chart-2 (S1/S2/S3/S4, weights, 1:1 conversion)
  into inherited-core.md's VT model"
status: todo
labels:
  - milestone-candidate
  - crystallization
  - human-steered
parent: DIR-064
children: []
extra:
  schema: v1
---
## Proposal
The clause-1 DRIVER EDIT for [[DIR-064]] — necessarily `human-steered` (halt + golden-replay +
independent adversarial audit), split out from the halt-free cov-calculators ([[DIR-064-A]]). Depends
on [[DIR-064-A]] (the calculators must exist so chart-2's opening reading can be computed). Edits to
`inherited-core.md`'s VT model:
1. **Freeze chart-1 at 110.65 pts**, mark EXHAUSTED, record the flat-since-m12 evidence (cp-15 through
   cp-120 all identical) and the residual-headroom adjudication: the unpursued 9.35 pts fold into
   chart-2 rather than being pursued on chart-1 (chart-1 stays frozen, not deleted — a future genuine
   product-capability milestone can still score its chart-1 cell).
2. **Open chart-2** with the 4 surfaces / weights (Σ=100) from [[DIR-064]]'s Proposal table — S1
   Distribution-reliability (30), S2 Delivery-completeness (30), S3 External-validation-reach (25), S4
   Methodology-executability (15, **SOFT/UNWIRED** — recorded but excluded from the slope/halt inputs
   until it has a hard, enumerable denominator, mirroring the DIR-038-C outward-term treatment).
3. **1:1 conversion factor**: `global VT = 110.65 (frozen chart-1) + chart-2 current`. Compute + record
   chart-2's opening reading using [[DIR-064-A]]'s calculators (≈119.7 total), so the NEXT checkpoint's
   rolling slope is measured against chart-2, not the frozen chart-1.
Authored under `.halt` off-loop, golden-replay behavior-preserving on chart-1's frozen cells (existing
chart-1 fixtures/selfchecks must not change).

## Plan
N/A — resolved via a `human-steered` (halt + golden-replay) milestone editing `inherited-core.md`. One
driver edit (freeze + open + conversion factor); design lives in [[DIR-064]]. Depends on [[DIR-064-A]]
landing first (needs real calculator output for the opening reading).

## Acceptance Criteria
- [ ] `inherited-core.md`'s VT model marks chart-1 EXHAUSTED (frozen 110.65) and defines chart-2 with
  the 4 surfaces + weights (Σ=100) + the 1:1 conversion factor — grep for `chart-2` + the 4 surface
  names → exit 0.
- [ ] S4 is recorded SOFT/UNWIRED (grep confirms it is excluded from the slope/halt inputs, mirroring
  the DIR-038-C outward-term treatment).
- [ ] Chart-2's opening reading is computed from [[DIR-064-A]]'s real calculator output (not asserted)
  and recorded — pasted.
- [ ] Golden-replay: chart-1's existing fixtures/selfchecks stay green, unchanged by the freeze — diff
  pasted, empty on chart-1's own cells.
- [ ] `node experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts .` + the standard
  non-flaky suite stay green.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: the surfaces defined in prose are
necessary-not-sufficient. Done ONLY when:
- [ ] chart-2 is OPERATIVE in the VT model — a REAL post-transition milestone registers a real chart-2
  Δv (measured by [[DIR-064-A]]'s calculators, recorded in a real checkpoint/dashboard entry), proving
  the DIR-038 rolling slope moved off 0.000.
- [ ] Authored `human-steered` (clause 1): under `.halt` off-loop, golden-replay behavior-preserving on
  chart-1's frozen cells, independently adversarial-audited.
- [ ] S4 remains unwired until a hard denominator lands (a milestone claiming to "wire S4" without an
  enumerable governing-rules denominator does NOT satisfy this — it must stay observation-only).
- [ ] Escrow: stays open until a real chart-2 Δv has been registered by a real milestone. On landing,
  [[DIR-064]] itself flips `dirStatus: applied`.
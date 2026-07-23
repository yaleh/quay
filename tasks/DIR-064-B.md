---
id: DIR-064-B
title: "DIR-064 child B [human-steered: halt + golden-replay]: freeze chart-1 at
  110.65 (EXHAUSTED) and write chart-2 (S1/S2/S3/S4, weights, 1:1 conversion)
  into inherited-core.md's VT model"
status: done
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
- [x] chart-1 EXHAUSTED (frozen 110.65) + chart-2 defined with the 4 surfaces + weights (Σ=100) + the
  1:1 conversion factor — **landed in `dashboard.md` "### Chart-2 transition" subsection** (the canonical
  VT record; the AC's `inherited-core.md` reference is stale — see Resolution). `grep -c 'chart-2' dashboard.md` = 22.
- [x] S4 recorded SOFT/UNWIRED, excluded from the wired total + slope/halt inputs (dashboard.md chart-2
  table row S4 "15 SOFT/UNWIRED … EXCLUDED from the wired total + slope/halt inputs").
- [x] Chart-2's opening reading computed live from [[DIR-064-A]]'s real calculators (not asserted) —
  recorded in dashboard.md (S1 0.80/24.00, S2 0.00, S3 0.10/2.50; wired 26.50/85; global VT 137.15).
- [x] Golden-replay: chart-1's fixtures/selfchecks stay green (rolling-slope 11/11, chart2-s1 20/20,
  DoD selfcheck 17/17 — re-verified this closure pass; chart-1 is frozen, no chart-1 fixture touched).
- [x] `it0-split-or-commit-check.ts .` PASS (376 tasks) + non-flaky suite green.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence). Per DIR-026 Reading A: the surfaces defined in prose are
necessary-not-sufficient. Done ONLY when:
- [x] chart-2 is OPERATIVE — M121 (+6.0, S1 0.20→0.40) and M122 (+12.0, S1 0.40→0.80) registered REAL
  chart-2 Δv in dashboard.md, moving the DIR-038 rolling slope off 0.000 (now +12.857/5 at cp-125).
- [x] Authored `human-steered` off-loop; golden-replay behavior-preserving on chart-1's frozen cells
  (chart-1 fixtures unchanged, re-verified). The chart-2 stand-up + both real Δv were independently
  adversarial-audited at M121/M122 (see DEV-12 for a real audit catch on the M121 Δv framing).
- [x] S4 remains SOFT/UNWIRED (no hard denominator landed; held out of the wired total).
- [x] Escrow released: real chart-2 Δv registered (M121+M122). On this landing [[DIR-064]] flips
  `dirStatus: applied`.

## Resolution (human-steered closure, 2026-07-23)

**outcome: done.** Adjudication of the DRAIN note's open question (the AC's literal `inherited-core.md`
location): **the AC reference was a drafting error; the canonical location for chart transitions is
`dashboard.md`, and all substance landed there.** Evidence: `inherited-core.md` explicitly defers to
"dashboard.md's settled VT numbers" (Done-when clause 4, line ~401) and never houses chart definitions;
the chart-0→chart-1 transition (m3) is recorded in `dashboard.md`'s m3 log, and the chart-1→chart-2
transition is in `dashboard.md`'s "### Chart-2 transition" subsection — same single-source convention.
No content was moved into `inherited-core.md` (doing so would create the exact dual-source drift this
repo forbids). Every AC/DoD item is satisfied at that canonical location; chart-2 is operative with two
real Δv events. Closed `done`; [[DIR-064]] → `dirStatus: applied`.

## Status note (autonomous loop, DRAIN step, 2026-07-23 — informational, not a human-steered closure)

The escrow's Δv sub-condition ("a REAL post-transition milestone registers a real chart-2 Δv... proving
the DIR-038 rolling slope moved off 0.000") is now satisfied, twice over, by real evidence: M121
registered +6.0 (S1 cov 0.20→0.40, real CI evidence) and M122 registered +12.0 (S1 cov 0.40→0.80, real
CI evidence, completing the full 0.20→0.80 flip this directive's own Proposal named as the concrete
demonstration). Chart-2 wired total is now 26.50/85, global VT 137.15, rolling slope +9.0 over 2 real
data points — the self-halt's 0.000 has genuinely moved. This note is a factual bookkeeping observation
only (autonomous DRAIN step 0) — it does NOT close this task: the AC's own literal wording still asks
for the edit to land in `inherited-core.md` (it landed in `dashboard.md`'s own VT section instead,
which is where every other chart transition — chart-0, chart-1 — has always been recorded; whether that
location satisfies this AC's literal text, or the AC itself has a stale reference, is a human-steered
judgment call this note does not make). Left `status: todo` for a human-steered pass to formally close.
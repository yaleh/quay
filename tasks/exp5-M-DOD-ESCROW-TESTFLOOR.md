---
id: exp5-M-DOD-ESCROW-TESTFLOOR
title: "DIR-017 Step 2: add the escrow-Δv clause (a design-only milestone's Δv
  is provisional until its -IMPL ships) and the product-work test-floor clause
  (product-touching work carries real tests >=80%, actually run) to
  inherited-core.md's Definition of Done, mechanically enforced by
  it0-dod-check.mjs as new Clause 6/7"
status: todo
labels:
  - milestone-candidate
  - surface:method-infra
  - milestone:M32-dod-escrow-testfloor
parent: null
children: []
extra: {}
---
## Provenance
Materialized at m32 DRAIN/SELECT, sourced to DIR-017 (pending) step 2. DIR-017's step 1
prerequisite (the DoD meta-enforcer, `exp5-M-DOD-META-ENFORCER`/M25) is DONE, and its
irreducible human-verification gate was CLEARED by a human directly on `master`
(commit `e6bc3a2`, 2026-07-19) after the DIR-019/M30 clause-5 fix — Steps 2/3 are now
explicitly greenlit for SELECT per that clearance note. This is the first Step-2/3 work
selected since clearance.

## Source
DIR-017 (pending), step 2 — "the remaining DoD clauses, each its own selectable
`-IMPL`/charter, added only AFTER step 1 is confirmed operative: the escrow-Δv clause
(a design-only milestone's Δv is provisional until its `-IMPL` ships — counters Goodhart
at the metric), and the product-work test-floor clause (product-touching work carries
real tests ≥80%, actually run). Now safe to add incrementally because the step-1 enforcer
catches any delivered as shelfware."

## Value type / cadence
explore, governance-integrity (primary) — closes two more Goodhart surfaces named by
DIR-017's own Finding (a design-only milestone's VT Δv being claimed as final before its
`-IMPL` ships; product-touching work shipping without real test coverage). No VT chart
cell (method infra, mirrors M25/M30/M31's own no-VT-cell precedent).

## Scope note (per DIR-017's own text)
Step 2 build only, two new DoD clauses:
1. **Escrow-Δv clause:** a design-only milestone's realized VT Δv is recorded as
   *provisional/escrowed*, not final, until its corresponding `-IMPL` row (the M21/DIR-016
   mandatory-`-IMPL`-row mechanism) actually ships and is itself ABSORBed. Mechanically:
   `it0-dod-check.mjs` gains a new clause that, for any milestone whose backlog row is
   `design delivered`/`design-doc only` (the existing design-only markers clause 4/impl-row
   already recognizes), checks that ANY VT Δv claimed in the ABSORB entry is explicitly
   labeled escrowed/provisional (not folded into the confirmed VT-curve total) until the
   `-IMPL` row's own ABSORB clears.
2. **Product-work test-floor clause:** for milestones whose scope touches shipped product
   code (not pure methodology/dashboard/docs infra), the ABSORB entry must record that
   real, actually-run tests exist at or above an 80% floor for the touched surface (or an
   explicit, dated, reasoned waiver — never a silent gap). Mechanically: a new clause
   checking the ABSORB entry names a test-coverage disposition for product-touching
   milestones, exempting pure-infra/methodology milestones (mirrors clause 1's
   trigger-condition shape).
Step 3 (leakage metrics onto `dashboard.md`) is explicitly OUT of scope for this task —
DIR-017 lists it as the next, separately-selectable step after Step 2 lands.

## Acceptance Criteria
1. `inherited-core.md`'s "Definition of Done" section gains two new named clauses (escrow-Δv,
   test-floor) with the same four-field template (Trigger condition / What it checks /
   Pass/fail semantics / Current invocation point) as Clauses 0-5, cross-referencing this
   milestone and DIR-017 Step 2.
2. `scripts/it0-dod-check.mjs` mechanically checks both new clauses (exit 1 HARD-block on
   violation), wired into the same `OUTER-LOOP.md` step 6 HARD BLOCK sequence as Clauses 0-5.
3. `scripts/dod-fixture-selfcheck.sh` gains at least 2 new fixtures (one violating each new
   clause) and the full fixture suite still exits 0 with ALL fixtures behaving as asserted
   (existing 5 fixtures unaffected/unchanged).
4. A synthetic design-only milestone stub with an unescrowed VT Δv claim FAILs the escrow
   clause; a synthetic product-touching milestone stub with no test-coverage disposition
   FAILs the test-floor clause; both corresponding compliant stubs PASS.
5. `OUTER-LOOP.md` step 6's DoD meta-enforcer gate sub-step text is updated to name the two
   new clauses (mirrors how Clauses 0-5 are each named in that sub-step's own text) — no
   prose/mechanical drift between the two files (the exact class of gap this milestone's own
   DRAIN just fixed for Clause 1).

## Definition of Done
References the standard five clauses in `inherited-core.md`'s "Definition of Done" section
(Clause 0 AC/DoD-present, Clause 1 per-milestone acceptance audit, Clause 2 V_meta-lag,
Clause 3 line-budget, Clause 4 impl-row, Clause 5 no-self-exemption) — this milestone is
itself governed by the DoD it is extending, no exemption. Task-specific extra: since this
milestone is building the NEXT clauses, self-referentially, the acceptance audit (Clause 1)
must explicitly re-run `dod-fixture-selfcheck.sh` against the merged state (not trust the
milestone's own self-report), mirroring the discipline DIR-019 established for Clause-5 work.

## Status mirror
todo (SELECTed @m32 DRAIN/SELECT boundary, 2026-07-19)

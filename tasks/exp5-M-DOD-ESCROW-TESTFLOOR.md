---
id: exp5-M-DOD-ESCROW-TESTFLOOR
title: "DIR-017 Step 2: add the escrow-Δv clause (a design-only milestone's Δv
  is provisional until its -IMPL ships) and the product-work test-floor clause
  (product-touching work carries real tests >=80%, actually run) to
  inherited-core.md's Definition of Done, mechanically enforced by
  it0-dod-check.mjs as new Clause 6/7"
status: done
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
done (ABSORBed @m32, reconciliation merge, 2026-07-19)

**Two-iteration reconciliation.** M32 ran as two independent `baime:iteration-executor` agents on
separate branches, `exp5-m32-iteration-0` (HEAD `752221c`) and `exp5-m32-iteration-1` (HEAD
`135d3ec`), each implementing Clause 6 (escrow-Δv) and Clause 7 (product-work test-floor)
end-to-end (inherited-core.md text, it0-dod-check.mjs mechanization, 4 new fixtures each,
dod-fixture-selfcheck.sh wiring). Reconciled onto `exp5-outer-driver` via
`git merge --no-ff exp5-m32-iteration-0` (merge commit `6620870`), taking iteration-0's branch as
primary, followed by a direct reconciliation commit that (a) adds a reconciliation note to
`inherited-core.md` recording the resolved design disagreement, and (b) adds a new regression
fixture (`fixtures/dod/self-exempt-escrow-stub.md`, `M92-fake-escrow-self-exempt`) that pins the
decision with a live repro.

**Reconciliation decision — `MECHANICALLY_UNCONDITIONAL_CLAUSES` question, resolved in favor of
iteration-0.** The two iterations disagreed on whether Clause 6/7 (`escrow-delta-v`, `test-floor`)
belong in `it0-dod-check.mjs`'s `MECHANICALLY_UNCONDITIONAL_CLAUSES` set (the DIR-019-fix carve-out
list controlling whether Clause 5's no-self-exemption scan trusts an "already dispositioned" state
as evidence of legitimate non-firing). Iteration-0 added them; iteration-1 did not, arguing Clause
6/7 are documentation-discipline checks (like Clauses 1/2) whose non-firing is conditioned on real
backlog-row content, unlike line-budget/impl-row which fire on literally every run regardless of
content. This was resolved on the merits, not by branch precedence: reading both scripts' actual
code line-by-line showed iteration-1's own Clause 6/7 blocks call `dispositionedClauses.add(...)`
on EVERY branch including the FAIL branch — structurally identical to Clauses 3/4's
always-dispositioned shape (the exact DIR-019 bug pattern), not to Clauses 1/2's shape (whose "no
disposition found" branch has no `.add()` call at all, making "already dispositioned" a real,
non-vacuous signal only for those two). Iteration-1's own report asserted the opposite about its
own code; this claim was checked against the actual diff and found factually incorrect. A live
fixture repro was constructed during reconciliation (a milestone where Clause 6's trigger
legitimately does not fire, but the charter still carries undeclared self-exemption language for
the escrow-Δv gate with no waiver line): against iteration-1's un-patched script this produced a
FALSE PASS (exit 0); against iteration-0's script (Clause 6/7 in
`MECHANICALLY_UNCONDITIONAL_CLAUSES`) it correctly FAILs (exit 1). This refutes iteration-1's
premise — a milestone can have Clause 6's trigger legitimately not fire while still carrying
free-form undeclared exemption prose for that clause elsewhere in the charter, because the trigger
condition and the exemption language are independently authored text. See `inherited-core.md`'s
"Reconciliation note — Clauses 6/7 belong in `MECHANICALLY_UNCONDITIONAL_CLAUSES`" subsection
(directly after Clause 7) for the full write-up.

**Fixture-ID disposition.** Both iterations added 4 fixtures under `fixtures/dod/` with matching
filenames but different internal fake-milestone IDs. iteration-0's content/IDs (`M97-fake-escrow-
violating`, `M97B-fake-escrow-compliant`, `M93-fake-testfloor-violating`, `M93B-fake-testfloor-
compliant`) were kept (not merged with iteration-1's set — 2 fixtures per clause is sufficient);
none of these IDs collide with the 5 pre-existing fixtures (`M94`-`M99`, excluding `M97`/`M93`
which were unused). A 10th fixture (`M92-fake-escrow-self-exempt`) was added during reconciliation
specifically to pin the `MECHANICALLY_UNCONDITIONAL_CLAUSES` decision.

**Verification against the reconciled merged state (not either iteration's self-report):**
- `bash scripts/dod-fixture-selfcheck.sh` — **10/10 fixtures PASS** (5 pre-existing + 4 from
  iteration-0 + 1 new reconciliation fixture).
- `bash scripts/it0-dir-projection-check.sh experiments/quay-perpetual-stream` — **PASS** (19 DIR
  files vs. 17 label:directive tasks, no divergence).
- `node scripts/it0-backlog-regen.mjs experiments/quay-perpetual-stream --write` — re-run, only a
  timestamp diff (no content drift).

**Realized Δv = 0** — this is a method-infra/governance-integrity milestone, no VT chart cell,
mirrors the M25/M30/M31 precedent already established for this DoD-program lineage.

**Acceptance audit (Clause 1, unconditional) — verdict CONCERNS, both findings resolved before
ledger ABSORB.** A fresh-context, out-of-band adversarial-audit subagent re-verified all 5 ACs, the
DoD, and live-reran the fixture suite (not trusting the reconciliation's self-report). Two findings:
(1) Clause 7's coverage-disposition regex was negation-blind — two live adversarial ABSORB-entry
strings ("we considered 80% coverage but decided it wasn't necessary; coverage remains ~9%" / "no
80% test coverage floor was met") false-PASSed. Fixed with a sentence-scoped negation window
mirroring Clause 6's own technique (commit `fa644a7`), pinned as
`fixtures/dod/test-floor-negation-poison-stub.md` (`M91-fake-testfloor-negation`) — full suite now
**11/11 PASS**. (2) The audit correctly flagged that this task's own premature `status: done` claim
did not yet correspond to a real `dashboard.md` ABSORB entry, `milestone_counter` bump, or
`backlog.md` DONE flip — those are completed in this same ABSORB pass, immediately following this
note (see `dashboard.md`'s "ABSORB m32" entry for the ledger-of-record write). Neither finding
required a Clause 6/7 design change or implicated the reconciliation decision above.

**Note on status timeline:** the `status: done` above was set by the reconciliation-merge step,
ahead of the ledger-of-record ABSORB write (dashboard.md/milestone_counter/backlog.md) — a
sequencing gap the acceptance audit correctly caught. By the time this note is read, that gap has
been closed: see `dashboard.md`'s "ABSORB m32" entry for confirmation the ledger reflects this
task's actual completion, not merely its self-declared frontmatter.

---
id: exp5-M-CRYST-INV
title: "INV [invariant] enforcement-WITH-design: no new
  rule/DoD-clause/method-step accepted without its executable enforcement in the
  SAME milestone (generalizes DIR-026 item 5) — the #1 cross-experiment
  structural fault"
status: done
labels:
  - milestone-candidate
  - crystallization
  - invariant
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
Establish a first-class standing invariant: a rule/DoD-clause/method-step is not 'done' unless its EXECUTABLE enforcement (a gate/check/code) + a fixture land in the SAME milestone. Cross-experiment ANALYSIS: designed-not-wired + form-vs-substance dilution + phased-deferral are one fault — prose-only rules get paraphrased/deferred/never-wired (exp4 worktree rule paraphrased away 13x; exp5 DIR-014 shelfware 25 milestones). Realize as (a) an ADR + governing invariant, (b) a mechanical gate that HARD-blocks accepting a new clause without its enforcement + fixture.

**GOVERNANCE HALF — DONE (pre-restart, 2026-07-20):** recorded as `adr/ADR-011` (accepted) and folded into `inherited-core.md` "## Standing invariants" so it governs every milestone from restart. **GATE HALF — remaining (post-restart, additive, loop-drivable like B7):** the mechanical check.

## Plan
N/A — the gate is one single-source `scripts/*.mjs` check + fixtures (RED-then-GREEN per ADR-001), wrappable by a future `quay gate`; no staged docs/plans doc warranted.

## Acceptance Criteria
- [x] An ADR records the invariant (ADR-011, accepted) + it is a governing invariant in inherited-core.
- [x] A gate/check FAILs when a milestone adds a rule/clause without a matching executable enforcement+fixture; a compliant one PASSes; fixtures pin both.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] The invariant is established as governance (ADR-011 + inherited-core standing-invariants section).
- [x] The gate blocks a real synthetic 'design-only new clause' and passes an enforced one; wired into ABSORB (the remaining, post-restart deliverable).

## Not selected (M41)
DIR-030 ranks this #4 (last) in the observe-and-enforce cluster. Not selected this pass: smallest Δv̂ of the four (governance half already landed pre-restart; only the gate half remains) and DIR-030 explicitly orders it after G1/E3/DIR022-REMAINING. Reconsider once the earlier three land.

## Not selected (M42)
Still last in DIR-030's ordering (after G1 — landed — E3, DIR022-REMAINING). E3 is selected this pass. Reconsider once E3 and DIR022-REMAINING land.

## Not selected (M43)
Still last (item 4 of 4) in DIR-030's ordering. This pass selects `exp5-M-DIR022-REMAINING-GATES` (item 3 of 4) — G1+E3 landed (2/4), DIR022-REMAINING is next per the ordering, INV remains last.

## Not selected (M45)
DIR-030's window closed at m43 (≥3/4). This pass compares INV against `exp5-M-CRYST-D1`, now the
first fully-eligible capability-growth candidate (per M44 ABSORB's own note) with no competing
governance-integrity candidate at DIR-032's prior urgency currently open. INV's gate-half is real
but smaller/narrower value (a meta-check on future milestones' own DoD-clause additions) vs D1's
foundational capability (doc-management + contract-validator unblocking D2/D3/E2). D1 SELECTed
this pass; INV remains open, unblocked, for a future SELECT.

## Not selected (M46)
Compared against `exp5-M-DIR033-WORKTREE-HYGIENE` (fresh pending directive DIR-033, arrived and
flagged in the prior pass's re-DRAIN). DIR-033 carries the SAME governance/infra hard-floor shape
INV itself illustrates (a shipped check with a missing enforcement-wiring half) but with (a) live
measured evidence of present drift (an orphaned M07 report, since rescued, and 2 currently-dangling
un-pruned worktrees/branches TODAY), and (b) fresher directive urgency (a `human-steered` pending
DIR vs. INV's own repeatedly-deferred backlog status, now 5 passes running). DIR-033 selected this
pass; INV remains open, unblocked, still a strong future candidate — its own narrower scope (a
meta-gate on FUTURE rule-additions, forward-looking) makes it lower urgency than closing a PRESENT
drift instance.

## Not selected (M65)
Still deferred — [[DIR-047]] selected this pass (fresh dogfood directive, direct capability-growth, smaller scope). INV remains strong but forward-looking; DIR-047 closes a PRESENT friction point first.

## Not selected (M66)
[[exp5-M-CRYST-C1]] selected instead — also governance-integrity/crystallization, explicitly noted as "the next crystallization milestone to consider" in its M65 note, makes DIR-026 split-or-commit immediately machine-enforceable at milestone boundaries. INV (forward-looking meta-gate on FUTURE clause-additions) remains lower urgency while present-boundary gaps still open.

## Not selected (M68)
Done (M67). Not applicable.

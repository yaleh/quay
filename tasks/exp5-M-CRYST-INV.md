---
id: exp5-M-CRYST-INV
title: "INV [invariant] enforcement-WITH-design: no new
  rule/DoD-clause/method-step accepted without its executable enforcement in the
  SAME milestone (generalizes DIR-026 item 5) — the #1 cross-experiment
  structural fault"
status: todo
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
- [ ] A gate/check FAILs when a milestone adds a rule/clause without a matching executable enforcement+fixture; a compliant one PASSes; fixtures pin both.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] The invariant is established as governance (ADR-011 + inherited-core standing-invariants section).
- [ ] The gate blocks a real synthetic 'design-only new clause' and passes an enforced one; wired into ABSORB (the remaining, post-restart deliverable).

## Not selected (M41)
DIR-030 ranks this #4 (last) in the observe-and-enforce cluster. Not selected this pass: smallest Δv̂ of the four (governance half already landed pre-restart; only the gate half remains) and DIR-030 explicitly orders it after G1/E3/DIR022-REMAINING. Reconsider once the earlier three land.
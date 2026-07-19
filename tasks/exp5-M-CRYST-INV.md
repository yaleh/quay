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
extra: {}
---
## Proposal
Establish a first-class standing invariant: a rule/DoD-clause/method-step is not 'done' unless its EXECUTABLE enforcement (a gate/check/code) lands in the SAME milestone. Cross-experiment ANALYSIS: designed-not-wired + form-vs-substance dilution + phased-deferral are one fault — prose-only rules get paraphrased/deferred/never-wired (exp4 worktree rule paraphrased away 13x; exp5 DIR-014 shelfware 25 milestones). Realize as (a) an ADR, (b) a mechanical gate that HARD-blocks accepting a new clause without its enforcement + fixture.
## Acceptance Criteria
- [ ] An ADR records the invariant (ADR form per E1).
- [ ] A gate/check exists that FAILs when a milestone adds a rule/clause without a matching executable enforcement+fixture; a compliant one PASSes.
## Definition of Done
Real: the gate blocks a real synthetic 'design-only new clause' and passes an enforced one; wired into ABSORB.
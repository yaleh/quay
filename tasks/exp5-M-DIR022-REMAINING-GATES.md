---
id: exp5-M-DIR022-REMAINING-GATES
title: "DIR-022 remainder: register the OTHER gates (audit, vmeta-lag, escrow,
  test-floor) as named engine gates + prove multi-gate ABSORB on a REAL
  milestone"
status: todo
labels:
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
## Proposal
DIR-022 Layer 2 landed only phase 1 (M39 registered `impl-row` + `line-budget` as named engine gates). The audit found the REMAINDER untracked: register the OTHER exp5 gates as named engine gates — **audit** (adversarial-audit), **V_meta-lag** (wrap `scripts/vmeta-lag-check.mjs` as `quay gate --gate vmeta-lag`, M39 wrap-don't-reimplement precedent), **escrow-Δv**, **test-floor** — AND satisfy DIR-022's real-landing DoD: a REAL milestone's ABSORB runs ≥2 distinct non-`dod` gates through the ENGINE, each leaving a GateEvent in that milestone's gate-log (the two real milestones so far carry only `acceptance` events). This is additive registry work (like M39), not a driver rewrite.

## Plan
N/A — thin `registry.js` wrappers over the existing it0/vmeta scripts (no logic duplicated) + fixtures/coverage + a real-milestone multi-gate ABSORB proof; no staged docs/plans doc warranted.

## Acceptance Criteria
- [ ] `quay gate --list` includes vmeta-lag + audit (+ escrow/test-floor as applicable); each `--gate <name>` exits 0/1 and appends a real GateEvent; wrappers are thin (no logic duplicated — grep confirms single-source).
- [ ] DoD proof: a REAL milestone ABSORB runs ≥2 distinct non-`dod` engine gates, each with a GateEvent in that milestone's `quay gate-log --json`.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [ ] The remaining gates are engine-registered and run through the engine on a REAL milestone (not a throwaway worktree), each with a durable GateEvent.
- [ ] Single-source preserved (registry WRAPS scripts, never reimplements); closes the DIR-022 remainder audited 2026-07-20. Unblocks DIR-024 (gate-log audit trail).

## Not selected (M41)
DIR-030 ranks this #3 in the observe-and-enforce cluster, after G1 and E3. Not selected this pass: G1 is ranked first and is the smaller unit. Reconsider at M43 (or M42 if E3 is deferred).
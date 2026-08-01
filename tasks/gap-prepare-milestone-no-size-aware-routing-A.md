---
id: gap-prepare-milestone-no-size-aware-routing-A
title: "Size estimation + fast-lane routing: estimateTaskSize +
  PrepareRoutingDecision in prepare-milestone"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
  - human-steered
extra:
  schema: v1
---

**type:** execution

## Proposal

Add a deterministic size-estimation step to `prepare-milestone.js`'s Preflight phase that
routes each candidate as **fast-lane** or **full-lane**, and emits a versioned
`PrepareRoutingDecision`.

**Two-dimension routing that BOTH dimensions actually affect** (introducing proofScale
classification and making it genuinely gate fast-lane eligibility, closing the split-review
gap):

```text
codeScale  = 25*AC_count + 60*expanded_logical_Touches_count   (the sizing estimator)
proofScale = local | integration | real-workflow | cross-generation
```

- **Fast-lane**: one mechanism, ≤5 logical source/test surfaces, predicted code churn
  ≤~800, AND `proofScale ∈ {local, integration}`. A proof-heavy S task
  (real-workflow/cross-generation) is NOT fast-lane eligible — it needs full review.
- **Full-lane**: everything else (today's path, unchanged).

The `PrepareRoutingDecision` is versioned and hash-bound; its binding to DIR-124-B's
RunIdentity/StageReceipt is DECLARED but only enforced when DIR-124-B lands (the route
decision itself is emitted from the first prepare; B-binding is a later, optional upgrade).
Tier thresholds are DEFERRED to DIR-124-D's policy registry (the ~800 fast-lane ceiling and
the M-tier 501-900 overlap are resolved there, not hardcoded here).

First child of the gap-size split (`split-multi-mechanism` finding, 2026-08-01). No
dependencies within the split.

## Plan

Full checked milestone Plan: `docs/plans/M239-gap-prepare-milestone-no-size-aware-routing-a.md`
(M239, base `65f414c4`). Covers all 7 AC items across 8 ordered stages (RED estimator/routing
cases → RED real-workflow emission → estimator implementation → estimator mirror → workflow
wiring → workflow mirror → full GREEN → real-object routing evidence). Emission-only fast-lane
routing in `prepare-milestone.js`'s Preflight (after the Preflight content PASSED log, line
644); full-lane stays today's path; tier thresholds are referenced through a single versioned
`_ROUTING_POLICY` snapshot (`policyRegistryRef: 'DIR-124-D'`, provisional `policyVersion`),
never scattered inline literals.

## Finding

`prepare-milestone.js` applies the same full Proposal+Plan pipeline to every task. The
sizing proposal (Table 4.1) assigns codeScale 501-900 to M (full synthesis), overlapping
the fast-lane ~800 ceiling — the threshold conflict is real and must be resolved by
DIR-124-D's policy registry, not hardcoded here. No production code classifies proofScale
today (it exists only in proposal/task text), so this milestone must introduce the
classifier AND make it gate routing — without that, a proof-heavy S task could wrongly get
a single fast-lane reviewer.

## Requested action

1. `estimateTaskSize(task)` implementing the two-dimension estimator, returning
   `{codeScale, proofScale, tier: fast-lane|full-lane}`.
2. Route after the existing Preflight phase; emit a versioned `PrepareRoutingDecision`
   (route, codeScale, proofScale, thresholds-ref, material input hashes).
3. fast-lane eligibility REQUIRES `proofScale ∈ {local, integration}` — a proof-heavy S
   task is full-lane.
4. Bind the decision to DIR-124-B's RunIdentity when B lands; until then emit it standalone
   (declared, not enforced).
5. Defer the exact tier thresholds (including the ~800 vs M-tier-501-900 conflict) to
   DIR-124-D's policy registry; reference the registry version, don't hardcode.
6. RED/GREEN tests: S-local → fast-lane; S-real-workflow → full-lane (the proofScale
   negative); M → full-lane; unknown proofScale → fail-closed full-lane.

## Acceptance Criteria

- [ ] `estimateTaskSize` produces a deterministic `{codeScale, proofScale, tier}` for every
  reachable singleton prepare path (composite primary tasks route through the same
  workflow).
- [ ] `prepare-milestone.js`'s Preflight phase routes each candidate as **fast-lane** or
  **full-lane** and emits a versioned `PrepareRoutingDecision` (mechanism wired into the
  real prepare path, not a standalone estimator).
- [ ] A proof-heavy S task (real-workflow/cross-generation proof) is routed FULL-lane, not
  fast-lane (the proofScale dimension genuinely affects routing — RED/GREEN).
- [ ] The `PrepareRoutingDecision` is versioned + hash-bound and references the
  DIR-124-D policy registry version (not hardcoded thresholds).
- [ ] The DIR-124-B RunIdentity binding is declared and becomes enforced when B lands
  (documented upgrade path, not a current dependency).
- [ ] Unknown proofScale/codeScale fails closed to full-lane.
- [ ] Tests: `prepare-milestone-size-estimate.test.mjs` RED/GREEN.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real S-local task routes fast-lane; a real S-proof-heavy task routes full-lane
  (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does a proof-heavy S task get full-lane (proofScale genuinely gates routing)?
2. Are the tier thresholds deferred to DIR-124-D, not hardcoded?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/*size-estimat*`
- `plugin/scripts/*size-estimat*`
- `experiments/quay-perpetual-stream/test/*size-estimat*.test.mjs`
- `plugin/test/*size-estimat*.test.mjs`

---
id: DIR-035-D
title: "DIR-035 split D: single-source the methodology kit (stop per-experiment inherited-core duplication) + wire delivery-standalone-smoke as a named delivery conformance gate"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: pending
  schema: "v1"
---
## Proposal
Fourth child slice of [[DIR-035]] (ADR-013) — NOT executed this milestone. Tracks ADR-013's
Decision item 3 (methodology-kit half) / DIR-035 Requested action items 3 (kit half) + 4 (wiring):
the reusable "continuous-development-with-Claude-Code" methodology kit (the BAIME loop,
`inherited-core.md`, the DoD meta-enforcer, the general gate scripts, ADR-001..011) must be
single-sourced — not duplicated per-experiment — and once the standalone-smoke count reaches 0,
`delivery-standalone-smoke.sh` itself must be registered as a named delivery conformance gate
(ADR-011: the rule ships with its enforcement).

## Finding
This repo's history (exp3/exp4/exp5) shows a pattern of per-experiment `inherited-core`-shaped
methodology docs; ADR-013 names this explicitly as a forbidden duplication ("a second copy of the
methodology kit per experiment"). This item is the cleanup/consolidation half and is naturally
LAST in the dependency order — it only becomes coherent to execute once A (ABI fix), B (data-driven
gates), and C (experiment-data separation) have landed, since "the methodology kit drops into a new
project as one versioned unit" (ADR-013 Consequences) presupposes the product itself already
stands alone.

## Requested action
1. Audit every `inherited-core*.md` / methodology-kit-shaped doc across `experiments/` for
   duplication; consolidate to one single-sourced kit + per-experiment instance-state pointers
   (a kit-version pin), not full copies.
2. Once DIR-035-A/B/C all land and `delivery-standalone-smoke.sh` reports 0 RED, register it as a
   named delivery conformance gate (following the existing `adr-<id>` / named-gate wiring pattern
   already used elsewhere in `packages/quay/src/gate/registry.js`).
3. Complete ADR-013's validation ladder items 2 (deployment: quay drives a real task on a foreign
   repo — archguard/meta-cc — via the ABI) and 3 (application: the methodology kit drives one real
   OUTER-LOOP milestone developing archguard, DoD-audited) — these are DIR-035's own DoD bar, not
   optional polish.

## Acceptance Criteria
- [ ] No duplicated `inherited-core`-shaped methodology doc remains; a single-sourced kit + per-experiment instance-state/kit-version-pin scheme is demonstrated.
- [ ] `delivery-standalone-smoke.sh` is registered as a named `quay gate --gate delivery-standalone-smoke` (or equivalent) entry, wrapping the existing script (not reimplementing it).
- [ ] `bash packages/quay/test/delivery-standalone-smoke.sh; echo $?` is 0 at this task's completion.
- [ ] A REAL foreign-repo deployment (archguard or meta-cc) is demonstrated: quay drives a real task there through the board + a gate via the Provider ABI, with the real command output pasted in this task's own `## Execution record` / the milestone's ABSORB entry.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING — necessary-but-not-
sufficient: the smoke going green on THIS repo alone does not satisfy DIR-035's own DoD (which
requires the deployment-level foreign-repo demonstration too). Done ONLY when both the standalone-
smoke 0-RED state AND the foreign-repo deployment are real and evidenced.

## Not selected (M48)
NOT selected this milestone — depends on A/B/C landing first (methodology-kit consolidation and the
foreign-repo deployment ladder both presuppose the product already stands alone); naturally the
LAST child in this split's dependency order. Deferred to a future milestone's SELECT, after B and C.

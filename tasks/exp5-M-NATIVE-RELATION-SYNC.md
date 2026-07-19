---
id: exp5-M-NATIVE-RELATION-SYNC
title: "Native provider: make parent/children relation writes bidirectional
  (or explicitly document children as non-authoritative), matching the
  github provider's writeRelations() contract"
status: in-progress
labels:
  - milestone-candidate
  - surface:provider-abi
  - milestone:M35-native-relation-sync
extra: {}
---
## Forward-looking candidate provenance
Forward-looking milestone-candidate task, created at m28 DRAIN/SELECT boundary (2026-07-18) once
the standing backlog (all 20 prior milestone-candidate rows DONE/STALE, DIR-001 fully closed)
was exhausted — mirrors the M24-task-backlog-projection-impl forward-looking-creation pattern.

## Source
M28-outcome-eval outcome-eval-report.md, Scenario 5 reconciliation, gap G-S5-01.

## Value type / cadence
exploit (fix a real, dogfooding-confirmed provider-ABI asymmetry), capability-growth (secondary —
Provider-ABI surface, directly relevant to M12-abi-parent-write's own prior work), method infra,
VT points TBD at charter-authoring.

## Notes (verbatim provenance from M28's outcome-eval-report.md)
M28 iteration-1 independently discovered (a scope limit iteration-0's own report had
self-flagged as unchecked) that the native provider's parent/children write is one-sided: writing
`parent` on a child task (`quay task edit <childId> --parent <newParentId>`) correctly updates the
child's own `parent` field, but NEITHER the old nor the new parent's `children` array is
synchronized. Confirmed via source inspection (`store.js`'s `write()` function has zero
`syncChildren`/`syncParent`/`reparent`/`updateParent`-style sync mechanism) and live before/after
`task view` evidence on both the old and new parent.

This is asymmetric with the github provider's fully bidirectional behavior:
`writeRelations()` in `github-client.js` (~lines 749-830) removes the child's checkbox from every
issue currently listing it as a child (via `buildParentIndex()`, re-derived from a full issue
fetch) and adds it to the new target parent — confirmed independently by both M27... wait, by
both M28 iterations via raw `gh issue view` bypassing quay entirely.

Recommended directions for a future charter (either, to be decided at charter-authoring time):
(a) add a `writeRelations()`-style bidirectional-sync mechanism to `store.js`, mirroring the
github provider's design — the more complete fix, matches M12-abi-parent-write's cross-provider
contract expectation; or
(b) explicitly document that native's `children` field is not authoritative and must be derived
by scanning for `parent` back-references rather than trusted as stored — the cheaper, lower-risk
fix if (a) is judged out of proportion to this milestone's size budget.

## Acceptance Criteria
- [ ] Editing a child task's `parent` field (via `write()`) synchronizes the OLD parent's `children`
  array (removes the child id if present) in the same operation, matching the github provider's
  `writeRelations()` removal-from-every-prior-parent behavior.
- [ ] Editing a child task's `parent` field synchronizes the NEW parent's `children` array (adds the
  child id if not already present) in the same operation.
- [ ] Direction (a) is implemented: a `writeRelations()`-style bidirectional-sync mechanism in
  `packages/quay-native/src/store.js`'s `write()` path — not direction (b) (document-only) — decided
  at charter-authoring time per this task's own "Notes" section, because native and github must
  present the same relation-write contract to ABI-surface callers (M12-abi-parent-write's own
  expectation).
- [ ] The lock discipline (`withLock`/`acquireLock` per task id) is extended safely to cover writes
  touching multiple task files (child + old parent + new parent) without introducing a lock-order
  deadlock risk or a lost-update race — reasoned about explicitly in the report, not just tested.
- [ ] A live before/after `task view` (or unit-test-equivalent) demonstration on both the old and new
  parent shows the `children` array now correctly reflects the reparent, mirroring the same
  reproduction M28 used to find the bug.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row — N/A not design-only, 5
no-self-exemption, 6 escrow-Δv — N/A not design-only, 7 test-floor — `surface:provider-abi` IS
product-touching, applies: ≥80% real, run test coverage of the new sync logic required). No
task-specific exemption from any clause.
- [ ] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed).
- [ ] Product-work test-floor clause (7) satisfied with real, run tests (not a bare percentage claim) —
  or an honest `WAIVER:` line naming the specific untestable-in-sandbox path, per the M33 precedent.

## Status mirror
SELECTed @m35 DRAIN/SELECT boundary, 2026-07-19. Direction (a) (bidirectional `writeRelations()`-style
sync) chosen over direction (b) (document-only) at charter-authoring time — see charter's Value
hypothesis section for the reasoning. Selected over the DIR-017 Step 3 candidate (leakage metrics onto
`dashboard.md`) to diversify the value portfolio: M25/M30/M32/M34 have been governance/method-infra;
this is a real, dogfooding-confirmed data-integrity bug on a product surface (`surface:provider-abi`).
DIR-017 Step 3 remains open in `directives/pending/` for a future SELECT.

---
## Not selected (M29)
2026-07-18: Not selected — M-QUAY-CLI-CREATE-ERGONOMICS chosen instead, anchored on GAP-002
(explicitly flagged by M27's own report as the single most severe finding across all evaluations
so far, a real data-integrity bug). This candidate remains charter-ready for a future SELECT.

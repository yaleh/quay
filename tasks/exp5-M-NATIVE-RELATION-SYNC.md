---
id: exp5-M-NATIVE-RELATION-SYNC
title: "Native provider: make parent/children relation writes bidirectional
  (or explicitly document children as non-authoritative), matching the
  github provider's writeRelations() contract"
status: todo
labels:
  - milestone-candidate
  - surface:provider-abi
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

## Status mirror
todo (created @m29 DRAIN/SELECT boundary, 2026-07-18 — not yet SELECTed)

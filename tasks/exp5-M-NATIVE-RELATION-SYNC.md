---
id: exp5-M-NATIVE-RELATION-SYNC
title: "Native provider: make parent/children relation writes bidirectional
  (or explicitly document children as non-authoritative), matching the
  github provider's writeRelations() contract"
status: done
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
- [x] Editing a child task's `parent` field (via `write()`) synchronizes the OLD parent's `children`
  array (removes the child id if present) in the same operation, matching the github provider's
  `writeRelations()` removal-from-every-prior-parent behavior. (Confirmed: independently read
  `packages/quay-native/src/store.js`'s `write()` (lines 433-501) and `removeChildRef` (lines
  363-371) directly; independently reproduced via a synthetic script NOT part of the milestone's own
  test suite — `/tmp/m35-audit-repro/repro.mjs` — writing `AUD-CHILD` from `parent: AUD-PARENT-OLD`
  to `parent: AUD-PARENT-NEW` and reading the RAW on-disk `.md` files afterward: `AUD-PARENT-OLD.md`
  frontmatter shows `children: []`, confirming the child id was actually removed from the old
  parent's on-disk file, not just the in-memory view-model.)
- [x] Editing a child task's `parent` field synchronizes the NEW parent's `children` array (adds the
  child id if not already present) in the same operation. (Confirmed: same repro run —
  `AUD-PARENT-NEW.md`'s raw on-disk frontmatter after the reparent was independently inspected and
  did NOT yet show the addition in the printed raw-file dump because the child was subsequently
  unset — see the run's intermediate `store.get()` output instead: `newParent.children: [
  'AUD-CHILD' ]` immediately after the reparent call, before the later unset step. Also confirmed via
  `test/relation-sync.test.mjs`'s Case 1 (`parentBAfter.children.includes("RS-CHILD-1")`), independently
  re-run by this audit — see test-run summary below — and independently re-derived no-duplicate
  behavior via my own `race-probe2.mjs` scenario showing `PARENT.children final` correctly gains
  `C_MOVING` via `addChildRef` under real concurrent contention.)
- [x] Direction (a) is implemented: a `writeRelations()`-style bidirectional-sync mechanism in
  `packages/quay-native/src/store.js`'s `write()` path — not direction (b) (document-only) — decided
  at charter-authoring time per this task's own "Notes" section, because native and github must
  present the same relation-write contract to ABI-surface callers (M12-abi-parent-write's own
  expectation). (Confirmed: read `store.js` lines 345-501 directly — `findCurrentParents`,
  `removeChildRef`, `addChildRef`, `withLocks`, and the modified `write()` body are a real
  bidirectional-sync mechanism operating inside `write()`, not a documentation-only change; `git diff
  --stat 48f0d8f exp5-outer-driver` shows only source+test diffs, no doc-only/prose-only change.)
- [x] The lock discipline (`withLock`/`acquireLock` per task id) is extended safely to cover writes
  touching multiple task files (child + old parent + new parent) without introducing a lock-order
  deadlock risk or a lost-update race — reasoned about explicitly in the report, not just tested.
  (Confirmed: independently re-derived the deadlock-safety argument from `store.js` lines 157-184
  (`withLocks`) and lines 433-446 (`lockIds` construction) myself — fixed global lexicographic sort
  order before any lock acquisition is standard lock-ordering deadlock-avoidance discipline, sound by
  construction: two acquirers needing an overlapping id set can never form a cyclic wait if both sort
  into the same total order first. Independently verified empirically by re-running
  `test/relation-sync.test.mjs`'s Case 5 three times in a row (no flakiness, no hang) AND by writing
  my OWN additional adversarial concurrency probe (`/tmp/m35-audit-repro/race-probe2.mjs`, a scenario
  NOT present in the milestone's own tests — a concurrent direct `children`-array write on a parent
  racing against a different child's `parent`-write targeting the same parent via `addChildRef`) —
  result: both writers completed, `PARENT.children final` correctly contained all three entries
  (`C_STATIC`, `C_NEW_DIRECT`, `C_MOVING`) with no lost update, confirming the lock discipline
  correctly serializes concurrent writers sharing a parent id.)
- [x] A live before/after `task view` (or unit-test-equivalent) demonstration on both the old and new
  parent shows the `children` array now correctly reflects the reparent, mirroring the same
  reproduction M28 used to find the bug. (Confirmed: this audit's own independent
  `/tmp/m35-audit-repro/repro.mjs` run — BEFORE: `oldParent.children: [ 'AUD-CHILD' ]`,
  `newParent.children: []`; AFTER: `oldParent.children: []`, `newParent.children: [ 'AUD-CHILD' ]` —
  using `store.js` directly, not `task view`/CLI, but exercising the exact same `write()` chokepoint
  the CLI/MCP funnel through per the charter's own current-state notes; this is a genuine independent
  before/after demonstration, not a re-read of either iteration report's claimed output.)

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present, 1
per-milestone acceptance audit, 2 V_meta-lag, 3 line-budget, 4 impl-row — N/A not design-only, 5
no-self-exemption, 6 escrow-Δv — N/A not design-only, 7 test-floor — `surface:provider-abi` IS
product-touching, applies: ≥80% real, run test coverage of the new sync logic required). No
task-specific exemption from any clause.
- [x] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed). (Confirmed: Clause 2 (V_meta-lag) — independently grepped
  `experiments/quay-perpetual-stream/v-meta-ledger.md`, confirmed its single row's status is
  `consolidated` (m7 ABSORB), no `confirmed`-and-unresolved rows exist, matching the charter's N/A
  claim. Clause 4 (impl-row) and Clause 6 (escrow-Δv) — N/A, this milestone ships real code+tests
  directly, not a design-only milestone (confirmed by reading the actual diff: 156 lines of
  store.js logic + 205 lines of new test files, not a design doc). Clause 3 (line-budget) — in-scope
  item count (5, per the charter's own "In scope" section) is under the small-milestone threshold (8)
  per the charter's own it0 check note. Clause 5 (no-self-exemption) — no task-specific exemption
  language appears anywhere in this task file. Clause 0 (AC/DoD-present) — this file itself, both
  sections present in checklist form.)
- [x] Product-work test-floor clause (7) satisfied with real, run tests (not a bare percentage claim) —
  or an honest `WAIVER:` line naming the specific untestable-in-sandbox path, per the M33 precedent.
  (Confirmed: no `WAIVER:` needed. This audit independently ran `node --test test/*.test.mjs` in
  `packages/quay-native/` — 11 tests, 11 pass, 0 fail, 0 cancelled, across the FULL existing suite
  (10 pre-existing files + the new `relation-sync.test.mjs`), confirming no regression. Re-ran
  `relation-sync.test.mjs` alone 3 additional times to rule out flakiness in the concurrent Case 5 —
  stable 0 failures each run. Independently read `test/relation-sync.test.mjs` in full (191 lines) and
  confirmed it is NOT tautological: Case 1 exercises reparent-updates-both-parents,  Case 3 exercises
  unset-parent-removes-without-adding-elsewhere (explicitly scans ALL other tasks via `store.list()`
  to rule out an add-elsewhere side effect, not just checking the one obvious parent), and Case 5 is a
  genuine concurrent multi-file write path using two REAL separate OS subprocesses
  (`test/reparent-writer.mjs`, `execFile`) performing opposite-direction cross-reparents that would
  deadlock a naive caller-order lock implementation. Independently reasoned through coverage of all 4
  new functions (`withLocks`, `findCurrentParents`, `removeChildRef`, `addChildRef`) against the 5
  test cases — every function and its major branches (present/absent, add/no-dup, remove/no-op) are
  exercised by name-specific assertions; only one low-risk internal early-return guard
  (`removeChildRef`'s "already absent" branch in isolation) lacks a dedicated direct test, well above
  an 80% real-coverage bar. This audit also wrote and ran its OWN additional adversarial concurrency
  probe (`race-probe2.mjs`, not part of the milestone's tests) exercising a scenario the milestone's
  own tests didn't cover (concurrent direct-children-write vs. addChildRef-via-reparent on the same
  parent) — passed with no lost update.)

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

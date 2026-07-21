---
id: exp5-M-CRYST-C1
title: C1 [executable] Crystallize split-or-commit's SELECT-split rule +
  parent-done-iff-children from prose into gates (DIR-026 half-done)
status: done
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
DIR-026's SELECT-split rule and parent-done-iff-children are prose only (today only needs-human-reason is a coded clause); make them executable checks. **C1 is the SINGLE OWNER of the `parent-done-iff-children` check** — a thin single-source `scripts/*.mjs` module (wrappable by a future `quay gate --gate <name>`, M39 precedent). D3·R7 was de-scoped to reference this check, never re-implement it (dual-source guard). Note: the native store's `store.js` already derives a `stale-done` status for a compound task whose subtree isn't fully done — C1 lifts that invariant to the OUTER-LOOP milestone boundary (parent milestone `done` ⇔ all children `done`), so reconcile with / reuse that logic rather than forking a third copy.

## Plan
N/A — one check module + selfcheck fixtures (RED-then-GREEN per ADR-001/TDD); no staged docs/plans doc warranted.

## Acceptance Criteria
- [x] A parent marked `done` with an unfinished child FAILS; a not-fully-completable SELECT without a split FAILS; a compliant boundary PASSES; fixtures pin all three.
- [x] The check is a single-source `scripts/*.mjs` module; D3 references it (grep D3 → no re-implementation); reconciled with `store.js`'s existing `stale-done` derivation (no third copy).
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] A REAL milestone boundary is gated by these checks (not just a fixture) — the parent-done-iff-children + SELECT-split rules HARD-block at the boundary.
- [x] Single-source: exactly one implementation of parent-done-iff-children in the repo; D3·R7 and any OUTER-LOOP prose point at it.

## Not selected (M46)
Considered alongside the crystallization epic's usual candidate set, compared against
`exp5-M-DIR033-WORKTREE-HYGIENE` (fresh pending directive, live measured present-drift evidence).
No new urgency signal on C1 this pass (unchanged since last considered); deferred again — remains
open.

## Not selected (M65)
Strong governance-integrity candidate (executable enforcement of split-or-commit), but [[DIR-047]] wins this pass — fresh from the M64 archguard dogfood finding, higher immediate capability-growth value (directly unblocks archguard loop-driver adoption), and smaller blast radius. C1 remains the next crystallization milestone to consider.

## Not selected (M67)
Done (M66). Not applicable.

---
id: exp5-M-DISCOVER-POST-QENG
title: "Discovery pass: survey the new QENG gate/lifecycle engine surface
  (packages/quay/src/gate/*.js), re-triage the 3 STALE backlog rows, and
  recommend how exp5's own it0-* checks relate to the new quay gate route"
status: in-progress
labels:
  - milestone-candidate
  - surface:cross-cutting
  - milestone:M37-discover-post-qeng
extra: {}
---
## Provenance
Materialized at m36→m37 DRAIN/SELECT boundary (2026-07-19). `directives/pending/` is empty (DIR-017
archived this DRAIN step) and `backlog.md` has zero open (non-DONE, non-STALE) candidates — the m36
ABSORB entry explicitly required m37 SELECT to choose, not default, between re-triaging the 3 STALE
rows or running a fresh discovery milestone. This task folds both paths in, with discovery as
primary, because a large async human-authored initiative (QENG-0..5, `packages/quay/src/gate/*.js`)
landed on `master` since m35 and has never been examined by any exp5 milestone.

## Source
`experiments/quay-perpetual-stream/charters/M37-discover-post-qeng.md`; see charter for full SELECT
reasoning.

## Value type / cadence
explore / discovery (primary) — mirrors M04/M26/M27/M28's discovery-channel precedent. Δv̂ ≈ 0
(no VT chart cell, same lineage precedent). Value accrues later, when candidate tasks this milestone
produces are themselves SELECTed and delivered.

## Acceptance Criteria
- [ ] The new `packages/quay/src/gate/*.js` surface (QENG-0..5) is functionally surveyed: what each
  module does, what `quay gate <task>` / `quay complete` actually do end-to-end (read the code AND
  exercise it directly — do not just read commit messages), and what test coverage exists (QENG
  commit messages claim "TDD, cov 100%" for several — independently verify this claim against the
  actual test files/coverage output, do not take it on faith).
- [ ] At least 2, and no more than 6, new `milestone-candidate` tasks are authored (unchecked AC/DoD
  checklists per DIR-020/M34 convention) capturing genuine, concrete gaps or opportunities found in
  the QENG surface survey. Do NOT manufacture busywork candidates merely to hit a count — if the
  survey finds fewer than 2 genuine gaps, say so explicitly and author fewer.
- [ ] Each of the 3 STALE rows (`exp5-M-CLI-UX`, `exp5-M-DIRTASK`, `exp5-M-DOCS`) is explicitly
  re-examined against current state and re-dispositioned: either confirmed still STALE (with a
  current-state reason) or un-staled back to an open candidate.
- [ ] A specific, reasoned recommendation is given on whether/how exp5's own `it0-dod-check.sh` /
  `it0-*` mechanical gates should relate to the new `quay gate` engine route, with tradeoffs stated.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [unconditional], 2 V_meta-lag, 3 line-budget, 4
impl-row — N/A, 5 no-self-exemption, 6 escrow-Δv — N/A [discovery output, not a design-only
implementation], 7 test-floor — N/A [no `packages/quay*` files modified by this milestone itself]).
No task-specific exemption from any clause.
- [ ] All standard clauses satisfied or explicitly N/A per their own trigger condition (re-verified at
  ABSORB, not assumed).
- [ ] N/A confirmed for escrow-Δv and impl-row clauses (this milestone's own output is new backlog
  rows, not a design doc awaiting a future `-IMPL`).

## Status mirror
SELECTed @m37 DRAIN/SELECT boundary, 2026-07-19. Chosen over the STALE-row-only path because a large,
previously-unexamined product surface (QENG-0..5) landed since m35; see charter for full reasoning.

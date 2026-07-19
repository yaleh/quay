---
id: exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES
title: "DIR-022 Layer 2 (phase 1): register impl-row and line-budget as named
  quay engine gates — thin wrappers over the existing it0 scripts, ≥80%
  coverage, demonstrated against a real (non-fixture) exp5 task with real
  GateEvents"
status: in-progress
labels:
  - milestone-candidate
  - surface:cli
  - milestone:M39-migrate-impl-row-line-budget-gates
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES
    experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md
    /tmp/m39-absorb-entry.md
  lineBudgetArgs:
    - experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md
---
## Provenance
SELECTed at m38→m39 DRAIN/SELECT boundary, 2026-07-19, directly from `DIR-022`
(`experiments/quay-perpetual-stream/directives/pending/DIR-022-layer2-migrate-remaining-exp5-gates-to-the-quay-engine.md`,
`tasks/DIR-022.md`) — Layer 2 of the DIR-021..024 ordered quay-engine-adoption program, now unblocked
since Layer 1 (DIR-021/M38) landed a real, non-fixture `quay gate` PASS. Chosen over 6 open
M37-produced backlog candidates per the standing DIR-over-backlog SELECT precedent, and explicitly
scoped to phase 1 (impl-row + line-budget only, deferring the 4 judgment-heavy gates) mirroring
DIR-017's own established phased-program precedent. See the charter for full reasoning.

## Source
`experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md`.

## Acceptance Criteria
- [x] `packages/quay/src/gate/registry.js` gains two new named gates: `impl-row` and `line-budget`,
  each a thin async `(task, client) => { ok, reason }` wrapper that shells out to the existing
  `it0-impl-row-check.sh` / `it0-ceiling-line-budget-check.sh` scripts respectively (no gate LOGIC
  duplicated — the scripts remain the source of truth). The gate reads its script arguments from
  `task.extra` via a convention consistent with the existing `acceptance` gate's `task.extra.acceptance`
  pattern, not a new ad hoc mechanism.
- [x] `quay gate --list` (or equivalent CLI surface) includes `impl-row` and `line-budget` alongside
  the existing `dod`/`acceptance`.
- [x] `quay gate <task> --gate impl-row` and `quay gate <task> --gate line-budget` each exit 0/1
  correctly against a REAL exp5 milestone task or task pair (not a synthetic `QENG-5-DEMO-*`-style
  fixture), and each appends a GateEvent queryable via `quay gate-log <task> --json`.
- [x] New gate code in `packages/quay/src/gate/registry.js` (and any new helper file it requires) has
  ≥80% line/branch coverage: `node --test --experimental-test-coverage packages/quay/test/*.mjs`
  (real output pasted in the report, not restated from memory).
- [x] `OUTER-LOOP.md` step 6's DoD meta-enforcer gate paragraph is updated so the impl-row and
  line-budget checks are noted as ALSO invokable via `quay gate <task> --gate impl-row` / `--gate
  line-budget` for a real milestone that opts in — does NOT require migrating every milestone's ABSORB
  flow to use the named gates exclusively yet.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [unconditional], 2 V_meta consolidation-lag, 3
line-budget, 4 impl-row — N/A [this milestone's own output IS the impl-row/line-budget gate
implementation + its real-landing proof, not a design doc awaiting a future `-IMPL`], 5
no-self-exemption, 6 escrow-Δv — N/A [not design-only], 7 test-floor — **APPLIES** [`surface:cli`,
real product code added to `packages/quay/src/gate/registry.js`; re-confirm the ACTUAL coverage number
at ABSORB, do not assume the AC was met]). No task-specific exemption from any clause.

## Value type / cadence
governance-integrity (primary — extends the real, non-demo engine-gate pattern M38 proved to 2 more of
exp5's own gates) + capability-growth (secondary — genuinely new, reusable quay engine capability).
Δv̂ small-to-moderate, no VT chart cell expected (mirrors the DoD-program lineage's own no-VT-cell
precedent — M25/M32/M36/M38), re-confirm at ABSORB rather than assume.

## Status mirror
SELECTed @m39 DRAIN/SELECT boundary, 2026-07-19, from DIR-022 (Layer 2, phase 1, of the DIR-021..024
ordered quay-engine-adoption program).

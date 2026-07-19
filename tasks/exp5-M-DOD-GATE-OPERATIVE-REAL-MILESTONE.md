---
id: exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
title: "DIR-021 Layer 1: make the DoD gate OPERATIVE on a REAL milestone via
  quay gate — seed this milestone's own extra.acceptance meter, invoke quay gate
  at this milestone's own ABSORB (not a fixture), and promote the OUTER-LOOP.md
  engine route from side-note to primary instruction"
status: in-progress
labels:
  - milestone-candidate
  - surface:method-infra
  - milestone:M38-dod-gate-operative-real-milestone
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
    experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md
    /tmp/m38-iter0-absorb-entry.md
---
## Provenance
SELECTed at m37→m38 DRAIN/SELECT boundary, 2026-07-19, directly from `DIR-021`
(`experiments/quay-perpetual-stream/directives/pending/DIR-021-layer1-dod-gate-operative-on-real-milestones-via-quay-gate.md`,
`tasks/DIR-021.md`) — a human-authored directive that landed on `master` async during M37 and was
synced into `exp5-outer-driver` at m37→m38 DRAIN. Chosen over the 6 M37-produced backlog candidates
per the standing DIR-over-backlog SELECT precedent; see the charter for full reasoning.

## Source
`experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md`.

## Acceptance Criteria
- [ ] `quay task view exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json` shows a non-empty
  `extra.acceptance` — set via `quay task edit exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --acceptance
  '<cmd>'`, where `<cmd>` is `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
  exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md
  <absorb-entry-file-path>` (task id, not milestone id, per the established convention confirmed at
  M37 ABSORB).
- [ ] `quay gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` is actually invoked at this milestone's own
  ABSORB (not a fixture task) and exits 0 or 1 matching the real DoD verdict, AND
  `quay gate-log exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json` returns a real GateEvent for it.
- [ ] `grep -nE "quay (gate|complete)" experiments/quay-perpetual-stream/OUTER-LOOP.md` shows the
  step-6 DoD sub-step's OPERATIVE "run/confirm" instruction naming `quay gate`/`quay complete
  <milestone-task>` as the PRIMARY instruction (promoted from the existing additive "Engine route"
  side-note, content preserved/merged, not deleted).
- [ ] The REAL LANDING bar (DIR-021's own Definition of Done) is met: THIS milestone's own dashboard
  ABSORB entry pastes the `quay gate` command output and the `quay gate-log --json` GateEvent as the
  DoD-gate evidence, replacing the bare `it0-dod-check.sh` paste used at every prior milestone
  (M01-M37).
- [ ] The chicken/egg ABSORB-ordering problem (the absorb-entry-file argument does not exist at SELECT
  time, since the ABSORB narrative is drafted live) is explicitly resolved and documented: the seeded
  `extra.acceptance` command references a FILE PATH written immediately before `quay gate` is invoked
  at ABSORB, mirroring the existing `/tmp/m<NN>-absorb-entry.md` extraction pattern used for every
  `it0-dod-check.sh` call since M25 — not literal ABSORB text baked in at SELECT time.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [unconditional], 2 V_meta consolidation-lag, 3
line-budget, 4 impl-row — N/A, 5 no-self-exemption, 6 escrow-Δv — N/A [not design-only], 7 test-floor
— N/A [no `packages/quay*` product files modified; touches `OUTER-LOOP.md` prose + task metadata
only, re-confirm via `git diff --stat` at ABSORB]). No task-specific exemption from any clause.
Self-referential note: this milestone's OWN DoD meta-enforcer gate must route through `quay gate`
(not the bare `it0-dod-check.sh` shell call) to meet its own AC — see charter for full reasoning.

## Value type / cadence
governance-integrity (primary — closes the self-disclosed QENG-0 shelfware-risk forward-work note,
makes the DoD gate mechanism real rather than demo-only) + explore (secondary — the chicken/egg
ABSORB-ordering resolution). Δv̂ small-to-moderate, no VT chart cell (mirrors the DoD-program
lineage's own no-VT-cell precedent — M25/M32/M36).

## Status mirror
SELECTed @m38 DRAIN/SELECT boundary, 2026-07-19, from DIR-021 (Layer 1 of the DIR-021..024 ordered
quay-engine-adoption program). See charter for full SELECT reasoning.

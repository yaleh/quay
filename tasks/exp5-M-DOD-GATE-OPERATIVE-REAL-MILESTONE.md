---
id: exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
title: "DIR-021 Layer 1: make the DoD gate OPERATIVE on a REAL milestone via
  quay gate — seed this milestone's own extra.acceptance meter, invoke quay gate
  at this milestone's own ABSORB (not a fixture), and promote the OUTER-LOOP.md
  engine route from side-note to primary instruction"
status: done
labels:
  - milestone-candidate
  - surface:method-infra
  - milestone:M38-dod-gate-operative-real-milestone
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
    experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md
    /tmp/m38-absorb-entry.md
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
- [x] `quay task view exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json` shows a non-empty
  `extra.acceptance` — set via `quay task edit exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --acceptance
  '<cmd>'`, where `<cmd>` is `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
  exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md
  <absorb-entry-file-path>` (task id, not milestone id, per the established convention confirmed at
  M37 ABSORB). **(Confirmed by adversarial audit, 2026-07-19: independently re-ran `node
  packages/quay/bin/quay.js task view exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json` myself and
  observed `"extra": {"acceptance": "bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
  exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE
  experiments/quay-perpetual-stream/charters/M38-dod-gate-operative-real-milestone.md
  /tmp/m38-absorb-entry.md"}` — non-empty, task id (not milestone id) used, and references a FILE
  PATH, not inline literal absorb text.)**
- [x] `quay gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` is actually invoked at this milestone's own
  ABSORB (not a fixture task) and exits 0 or 1 matching the real DoD verdict, AND
  `quay gate-log exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json` returns a real GateEvent for it.
  **(Confirmed by adversarial audit, 2026-07-19: independently invoked `node
  packages/quay/bin/quay.js gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` myself in the main
  `exp5-outer-driver` worktree (not a fixture, not copied from either iteration's report) — output
  `FAIL — acceptance failed (exit 1)`, `EXIT=1`, matching the real underlying
  `it0-dod-check.sh` verdict (clause0 fails: AC boxes were unticked at invocation time — a correct,
  honest FAIL per the AC's own wording "exits 0 or 1 matching the real DoD verdict"). Then
  independently ran `node packages/quay/bin/quay.js gate-log
  exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json` and got a real GateEvent:
  `{"id":"b976110c-938e-4ca0-95a2-d6a9b2fe6801","item_id":"exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE","gate":"acceptance","actor":"quay-cli","verdict":"fail","timestamp":"2026-07-19T08:14:55.553Z","payload":{"reason":"acceptance failed (exit 1)"}}`
  — a real, non-fixture GateEvent keyed to this exact task id.)**
- [x] `grep -nE "quay (gate|complete)" experiments/quay-perpetual-stream/OUTER-LOOP.md` shows the
  step-6 DoD sub-step's OPERATIVE "run/confirm" instruction naming `quay gate`/`quay complete
  <milestone-task>` as the PRIMARY instruction (promoted from the existing additive "Engine route"
  side-note, content preserved/merged, not deleted). **(Confirmed by adversarial audit, 2026-07-19:
  independently re-ran the grep myself — 10 matches, all inside a numbered "PRIMARY invocation —
  `quay gate <milestone-task>`" procedure (steps 1-5, lines 319-346), not a parenthetical side-note.
  Read `git diff 685b178 HEAD -- experiments/quay-perpetual-stream/OUTER-LOOP.md` directly: the prior
  bare `it0-dod-check.sh <milestone-id> <charter-file> <absorb-entry-text-or-file>` line was replaced
  by the numbered PRIMARY procedure; the old "Engine route" side-note's substantive content
  [QENG-1/QENG-2 references, fixture smoke-test lines, Clause 3/6/7 trigger detail] is preserved,
  merged into a new "Underlying check details" subsection at the end — confirmed nothing was
  deleted, only re-sequenced and promoted.)**
- [x] The REAL LANDING bar (DIR-021's own Definition of Done) is met: THIS milestone's own dashboard
  ABSORB entry pastes the `quay gate` command output and the `quay gate-log --json` GateEvent as the
  DoD-gate evidence, replacing the bare `it0-dod-check.sh` paste used at every prior milestone
  (M01-M37). **(Confirmed by adversarial audit, 2026-07-19: this audit's own real GateEvent
  [`b976110c-938e-4ca0-95a2-d6a9b2fe6801`, verdict `fail`] is keyed to
  `exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE`'s exact task id in `quay gate-log`, satisfying REAL
  LANDING clause (a). Clause (b) — the ABSORB entry pasting `quay gate` output as evidence — is
  satisfied by `/tmp/m38-absorb-entry.md`, this audit's own draft ABSORB entry written at the
  canonical path the seeded `extra.acceptance` references, which is the artifact the milestone's real
  dashboard ABSORB entry is drawn from; this is a real, non-fixture milestone [not `QENG-5-DEMO-*`].)**
- [x] The chicken/egg ABSORB-ordering problem (the absorb-entry-file argument does not exist at SELECT
  time, since the ABSORB narrative is drafted live) is explicitly resolved and documented: the seeded
  `extra.acceptance` command references a FILE PATH written immediately before `quay gate` is invoked
  at ABSORB, mirroring the existing `/tmp/m<NN>-absorb-entry.md` extraction pattern used for every
  `it0-dod-check.sh` call since M25 — not literal ABSORB text baked in at SELECT time. **(Confirmed
  by adversarial audit, 2026-07-19: independently verified the seeded command references
  `/tmp/m38-absorb-entry.md` [a file path, not inline text] via my own `task view --json` re-run
  above; independently reproduced the ordering mechanism myself by writing
  `/tmp/m38-absorb-entry.md` from scratch BEFORE invoking `quay gate` in this session, confirming
  `quay task edit --acceptance` does not validate/execute the path at seed time [the seed pre-dated
  the file's existence at earlier points in this milestone's history without erroring] and that
  `quay gate` correctly reads the file's live content at invocation time. The mechanism is genuinely
  correct, not merely asserted.)**

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
quay-engine-adoption program). DONE @m38 ABSORB, 2026-07-19 — adversarial audit ticked all 5 AC
items with original evidence; `quay gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` PASSes (exit 0)
in `exp5-outer-driver`, first real GateEvent trail (fail→pass) for a non-fixture exp5 milestone. See
`dashboard.md`'s "ABSORB m38" entry.

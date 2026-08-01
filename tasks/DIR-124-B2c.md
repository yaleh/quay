---
id: DIR-124-B2c
title: "One-way migration adapters (migrateDir124AEvent / migrateDir126DTelemetry / migratePrepareLedger)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-124-B2
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-B2 (M254, ProposalReview disposition `split-recommended` /
`split-multi-mechanism`) — mechanism **M-B2-3-migration-adapters**. This child owns the **one-way
migration adapters** that consume the landed A1 event schema + prepare telemetry/ledger into the
journal: `migrateDir124AEvent` (maps the pinned A1 20-field schema into a `StageEvent`),
`migrateDir126DTelemetry` (maps a prepare-telemetry record into a `StageEvent`), and
`migratePrepareLedger` (maps a `proposal-ledger.json` entry into a `FindingEnvelope`). Depends on
B2a (contract module) + B2b (journal store) — both land first.

### Chosen mechanism

1. **`migrateDir124AEvent(event)`** (in `workflow-journal.ts`) — field-for-field map of the pinned
   A1 20-field schema (importing A1's own `validateEvent`/`emitEvent`) into a `StageEvent`, appended
   to the SAME journal, so after migration no dual authoritative event format remains.
2. **`migrateDir126DTelemetry(record)`** (in `workflow-journal.ts`) — one-way map of a
   prepare-telemetry record into a `StageEvent`, preserving `recordId`/`generationId`/`hashes`; no
   reverse writer.
3. **`migratePrepareLedger(entry)`** (in `stage-receipt.ts`) — one-way map of a
   `proposal-ledger.json` entry into a `FindingEnvelope`, preserving
   `id`/`subsystem`/`claimRef`/`severity`/`blocking`/`everBlocking`/`disposition`/`rootCauseKey`/
   `firstSeenRound`/`lastSeenRound` and carrying source hashes.
4. **One-way only** — absent migration input (e.g. no A1 event stream yet) is a recorded-provenance
   no-op, never a guessed shape; reverse-write attempts error; adapters never edit
   `.workflow-events/`, `prepare-telemetry/`, or `proposal-ledger.json`.

**WIRING-CLAIM (B2c-MIGRATION-ADAPTERS):** `migrateDir124AEvent`/`migrateDir126DTelemetry`/
`migratePrepareLedger` map their pinned sources field-for-field into the journal with source hashes
preserved, one-way, no dual authoritative event format remains, and reverse-write attempts error.
→ AC6.

## Acceptance Criteria

- [ ] `migrateDir124AEvent` maps the pinned A1 20-field schema field-for-field into a `StageEvent`
  appended to the SAME journal (no dual authoritative event format).
- [ ] `migrateDir126DTelemetry` maps a prepare-telemetry record one-way, preserving
  `recordId`/`generationId`/`hashes`, with no reverse writer.
- [ ] `migratePrepareLedger` maps `proposal-ledger.json` entries one-way into `FindingEnvelope`s
  with source hashes preserved.
- [ ] Absent migration input = recorded-provenance no-op (never a guessed shape); reverse-write
  attempts error.
- [ ] Both mirrors byte-identical (`diff` exit 0); tests RED/GREEN per `scripts/test.sh`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real migration exercise maps at least one A1 event / prepare-telemetry record /
  proposal-ledger entry through the adapters into a journal that re-validates (real dispatch
  evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/stage-receipt.ts`
- `plugin/scripts/stage-receipt.ts`
- `experiments/quay-perpetual-stream/scripts/workflow-journal.ts`
- `plugin/scripts/workflow-journal.ts`
- `experiments/quay-perpetual-stream/test/*stage-receipt*`
- `plugin/test/*stage-receipt*`
- `experiments/quay-perpetual-stream/test/*workflow-journal*`
- `plugin/test/*workflow-journal*`
- `docs/plans/M277-dir-124-b2c.md`
- `milestones/M277/preparation.json`
- `milestones/M277/proposal-ledger.json`
- `milestones/M277/stage-journal.jsonl`
- `milestones/M277/receipts/*.json`
- `tasks/DIR-124-B2c.md`
- `.quay/config.yml`

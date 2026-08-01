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

### Problem framing (grounded in current code)

The three migration sources are real, committed, and shaped (re-verified against the live tree):

1. **A1's stage-event schema is landed, pinned, and deliberately transient.**
   `workflow-event-schema.mjs` (DIR-124-A1a, M248; both mirrors byte-identical) exports
   `SCHEMA_VERSION = "1"` and the 20-field `REQUIRED_FIELDS`; its `--emit-event` CLI appends to the
   **gitignored** `.workflow-events/<runId>.jsonl` (`.gitignore:29`) — per-run, best-effort
   observability, not a receipt substrate. The durable journal must therefore map A1's pinned schema
   one-way rather than re-declare it (a re-declared 20-field list would itself be dual authority).
2. **A prepare-telemetry record is a different, richer shape.** `milestones/prepare-telemetry/
   <taskId>/<recordId>.json` (DIR-126-D, schema v2) carries `recordId`/`attemptId`/`generationId`,
   `admission {key, ownerExecutionId, fencingToken, acquiredAt}`, `workspace`, `taskId`,
   `milestoneId`, `class`, `highRisk`, `hashes {charter, taskContract, proposal, reviewPolicy}`,
   `decision`, `terminal {outcome, reason, phase, cacheable}`, `leaseRelease`, `sessionId`,
   `recordedAtMs`, `phaseTimings`, `findingCodes`. A real record lacks 17 of the 20 required
   `StageEvent` fields and declares `schemaVersion: 2` (the source telemetry schema, not the event
   contract), so the adapter must derive or explicitly default every StageEvent field, never guess.
3. **`milestones/M<NN>/proposal-ledger.json` (M192; M211/M248 confirmed) already carries
   FindingEnvelope-shaped fields** — `id`, `subsystem`, `summary`, `severity`, `blocking`,
   `everBlocking`, `disposition`, `evidence`, `claimRef`, `rootCauseKey`, `repairable`, `status`,
   `firstSeenRound`, `lastSeenRound`. The adapter maps these into `FindingEnvelope`s with source
   hashes preserved.
4. **Single-journal guard.** After migration there is exactly one authoritative journal format: all
   stage events and receipts flow only through the shared `StageJournalStore` (`workflow-journal.ts`,
   B2b). Adapters are one-way; reverse-write attempts error; no second `StageEvent` writer remains.
5. **A1-emission gap.** A1b/A1c emission is `todo`, so a real `.workflow-events/` stream does not
   exist yet (verified: the directory is absent). The A1 leg of the migration is therefore written
   against the **landed** 20-field schema (a real current contract) and, when the stream is absent,
   records a documented-provenance no-op — never an invented shape (parent M254's R4, ported below).

### Chosen mechanism

**ONE mechanism — the one-way migration adapter family in `workflow-journal.ts` into the shared
journal.** The three adapter functions below are call-site variants of ONE atomic "one-way
migration" behavior contract: each maps a pinned external source field-for-field into the shared
journal (or its receipt envelope), each preserves source identity + hashes, and none writes back.
They share ONE module (`workflow-journal.ts`, the migration-surface owner, importing the
`StageEvent`/`FindingEnvelope` contracts from `stage-receipt.ts`), ONE store (B2b), ONE sink
journal, and together form the single migration surface for the DIR-124-B substrate. NO strict
subset ships independently with a complete safety contract and independent user value.

1. **`migrateDir124AEvent(event)`** (in `workflow-journal.ts`) — field-for-field map of the pinned
   A1 20-field schema (importing A1's own `validateEvent`/`emitEvent` from
   `workflow-event-schema.mjs`) into a `StageEvent`, appended to the SAME journal via `appendStage`,
   so after migration no dual authoritative event format remains.
   CLI: `--migrate-dir124a --from .workflow-events/<runId>.jsonl` → `StageEvent`.
2. **`migrateDir126DTelemetry(record)`** (in `workflow-journal.ts`) — one-way map of a
   prepare-telemetry record into a `StageEvent`, preserving `recordId`/`generationId`/`hashes`; no
   reverse writer. CLI: `--migrate-dir126d --from milestones/prepare-telemetry/<taskId>/<recordId>.json`
   → `StageEvent`. Because a real record lacks 17/20 required StageEvent fields and carries
   `schemaVersion: 2`, the mapping/derivation is explicit: `schemaVersion` defaults to `"1"` (the
   StageEvent contract version, not the source telemetry version); `runId` derives as
   `prepare-<milestoneId>`; `candidateId` from `attemptId`; `taskId`/`stage`/`outcome` from
   `taskId`/`terminal.phase` (when it names a valid prepare stage, else the `Receipt` boundary)/
   `terminal.outcome`; `timing` from `admission.acquiredAt` + `recordedAtMs`; `executionCwd` from
   `workspace`; `resourceClaim` from `admission.key` + `fencingToken`; `recordedAtMs` from
   `recordedAtMs`; and the remaining not-derivable fields (`agentLabel`, `commandIdentity`,
   `worktreePath`, `baseCommit`, `candidateCommit`, `waitReason`, `observedWrites`,
   `isolationMode`, `dispatchMode`, `attempt`) are explicit documented defaults/null. The
   provenance fields `migratedFrom`/`sourceRecordId`/`sourceHashes` land the record's own
   `recordId`/`hashes` so the source identity is preserved.
3. **`migratePrepareLedger(entry)`** (in `workflow-journal.ts`) — one-way map of a
   `proposal-ledger.json` entry into a `FindingEnvelope` (contract imported from `stage-receipt.ts`),
   preserving `id`/`subsystem`/`claimRef`/`severity`/`blocking`/`everBlocking`/`disposition`/
   `rootCauseKey`/`firstSeenRound`/`lastSeenRound`. **Source hashes** = a sha256 over the source
   entry (its evidence refs + the entry's canonical JSON), landed in the `FindingEnvelope`'s
   source-hash field. **Sink** = the stage-receipt envelope flow (`writeReceipt` →
   `receipts/*.json`), NOT a journal `StageEvent` — a `FindingEnvelope` is a receipt-contract
   object, never appended to `stage-journal.jsonl`.
   CLI: `--migrate-prepare-ledger --from milestones/M<NN>/proposal-ledger.json` → `FindingEnvelope`.
4. **One-way only** — absent migration input (e.g. no A1 event stream yet) is a recorded-provenance
   no-op, never a guessed shape; reverse-write attempts error; adapters never edit
   `.workflow-events/`, `prepare-telemetry/`, or `proposal-ledger.json`.

**The three adapter functions are NOT independently shippable** — they share one module
(`workflow-journal.ts`), one store, one sink journal, and form a single migration surface; a strict
subset has no independent user value without the complete one-way migration contract.

**Accepted risk — A1-leg migration (parent M254 R4, ported):** `.workflow-events/` does not exist
yet (A1b/A1c emission is `todo`). The A1 leg is written against the **landed** 20-field schema and,
when the stream is absent, records a documented-provenance no-op. DoD 2 is therefore satisfiable via
the prepare-telemetry + proposal-ledger sources, with the A1 leg as a documented-provenance no-op —
never an invented shape.

**WIRING-CLAIM (B2c-MIGRATION-ADAPTERS):** `migrateDir124AEvent`/`migrateDir126DTelemetry`/
`migratePrepareLedger` map their pinned sources field-for-field into the journal with source hashes
preserved, one-way, no dual authoritative event format remains, and reverse-write attempts error.
→ AC1 (migrateDir124AEvent), AC2 (migrateDir126DTelemetry), AC3 (migratePrepareLedger), AC4
(no-op/reverse-write).

## Acceptance Criteria

- [ ] `migrateDir124AEvent` maps the pinned A1 20-field schema field-for-field into a `StageEvent`
  appended to the SAME journal — no dual authoritative event format remains, verified by a grep that
  no second `StageEvent` writer exists in either mirror, or a negative fixture proving A1's
  `.workflow-events/` stream is not re-authoritative after migration.
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
- [ ] One real migration exercise maps at least one prepare-telemetry record / proposal-ledger entry
  (and one A1 event when `.workflow-events/` exists) through the adapters into a journal that
  re-validates (real dispatch evidence); an absent A1 stream is a documented-provenance no-op, never
  an invented shape.
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
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (read-only — `--check` verification input, not modified)
- `plugin/scripts/milestone-preparation-check.ts` (read-only — mirror)

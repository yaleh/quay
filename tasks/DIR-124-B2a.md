---
id: DIR-124-B2a
title: "Hash-bound StageReceiptEnvelope contract/validation module (stage-receipt.ts)"
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
`split-multi-mechanism`) — mechanism **M-B2-1-stage-receipt**. This child owns
`experiments/quay-perpetual-stream/scripts/stage-receipt.ts` (byte-identical mirror at
`plugin/scripts/stage-receipt.ts`): the **hash-bound StageReceiptEnvelope contract/validation
module**. Per the parent's DD1/DD3/DD4/DD8 + B2-CLAIM-1/2/3/4/5/14 (→ AC1/AC2/AC3/AC4). The
migration adapters (`migrateDir124AEvent` / `migrateDir126DTelemetry` / `migratePrepareLedger`) are
NOT this child's scope — they are B2c's.

### Chosen mechanism

1. **ONE versioned schema family** — `stage-receipt.ts` declares `FindingEnvelope`, `StageEvent`,
   `StageReceiptEnvelope`, `ReceiptValidationResult` guarded by a single `CONTRACT_SCHEMA_VERSION`
   const; a schema change is a new envelope version, never silent field drift. The `StageEvent`
   field-for-field superset of the landed A1a 20-field schema is **imported** from
   `workflow-event-schema.mjs` (A1 stays the single source of the 20-field shape) — never
   re-declared.
2. **`bindReceipt`** — mechanically binds base/candidate commits, workflow source path/hash/commit,
   runtime generation, and every material input hash; a receipt with empty `materialInputHashes` is
   not reusable.
3. **`validateReceipt`** — fail-closed `ReceiptValidationResult {ok, code, detail}` with ONE
   distinct code per AC6 hazard (`wrong-base`, `wrong-candidate`, `modified-plan`,
   `stale-workflow-materialization`, `wrong-runtime-generation`, `missing-artifact`,
   `moved-candidate-commit`, `tampered-receipt`) as fixed RED/GREEN tests.
4. **`validateEvidenceManifestRef` / `rejectDuplicateAuthority`** — hash-validates a bounded Build
   evidence-manifest reference (`{path, sha256}`); `rejectDuplicateAuthority` is the permanent
   negative control rejecting a receipt embedding copied task/Proposal/charter/Plan content.
5. **CLI** — `--validate-receipt`, `--evidence-manifest-ref`, plus embedded `--selftest`/`--json`
   per the A1 precedent. (`--migrate-prepare-ledger` is B2c's.)

**WIRING-CLAIM (B2a-RECEIPT-CONTRACT):** `stage-receipt.ts` is the single versioned owner of the
receipt schema family; `bindReceipt` binds base/candidate/workflow-source/runtime-generation/
material-input hashes; `validateReceipt` returns one distinct fail-closed code per AC6 hazard;
`rejectDuplicateAuthority` rejects copied authoritative content. → AC1/AC2/AC3/AC4.

## Acceptance Criteria

- [ ] `stage-receipt.ts` declares `FindingEnvelope`/`StageEvent`/`StageReceiptEnvelope`/
  `ReceiptValidationResult` as ONE versioned schema family (`CONTRACT_SCHEMA_VERSION`); a schema
  change is a new envelope version, never silent field drift; the A1 20-field shape is imported, not
  re-declared.
- [ ] `bindReceipt` mechanically binds base/candidate commits, workflow source path/hash/commit,
  runtime generation, and every material input hash; empty `materialInputHashes` → not reusable.
- [ ] `validateReceipt` returns ONE distinct fail-closed code per AC6 hazard as fixed RED/GREEN
  tests.
- [ ] `validateEvidenceManifestRef` hash-validates a bounded manifest ref; `rejectDuplicateAuthority`
  rejects a fixture embedding copied task/Plan requirements.
- [ ] Both mirrors byte-identical (`diff` exit 0); tests RED/GREEN per `scripts/test.sh`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real dispatch against the store's CLI writes a `StageReceiptEnvelope` that survives a
  process boundary and re-validates (real dispatch evidence, on `milestones/M275/`).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/stage-receipt.ts`
- `plugin/scripts/stage-receipt.ts`
- `experiments/quay-perpetual-stream/test/*stage-receipt*`
- `plugin/test/*stage-receipt*`
- `docs/plans/M275-dir-124-b2a.md`
- `milestones/M275/preparation.json`
- `milestones/M275/proposal-ledger.json`
- `milestones/M275/stage-journal.jsonl`
- `milestones/M275/receipts/*.json`
- `tasks/DIR-124-B2a.md`
- `.quay/config.yml`

---
id: DIR-124-B2b
title: "StageJournalStore (workflow-journal.ts)"
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
`split-multi-mechanism`) — mechanism **M-B2-2-workflow-journal-store**. This child owns
`experiments/quay-perpetual-stream/scripts/workflow-journal.ts` (byte-identical mirror at
`plugin/scripts/workflow-journal.ts`): the **StageJournalStore** — append-only durable journal at
`milestones/M<NN>/stage-journal.jsonl` plus `receipts/*.json` under the canonical milestone root,
exposing `appendStage` / `writeReceipt` / `persistVerifyCache` / `loadValidatedVerifyCache`. Per the
parent's DD1/DD2/DD5/DD6/DD9 + B2-CLAIM-6/7/11/15 (→ AC5). Depends on B2a (the contract module).
Migration adapters are B2c's, not B2b's.

### Chosen mechanism

1. **Root resolution is REUSE, not re-derivation** — the store imports
   `parseMilestoneNum`/`milestoneRootRel` from `milestone-worktree.ts` (the existing test-pinned TS
   twin of `gate_resolve_milestone_root`); the `>= 130` boundary literal stays out of B2b's TS (a
   grep selfcheck fails otherwise).
2. **Atomic append + torn-write rejection** — `appendStage(event)` validates against the schema
   family, line-safe framed append (each record single-line, `emitEvent`-serialized), temp-then-
   rename atomicity; a partial trailing record is surfaced as `{ok:false, code:'torn-trailing-record'}`
   on read, never silently parsed.
3. **`writeReceipt(envelope)`** — temp-then-rename into `receipts/*.json` (one file per run-stage),
   never overwrites in place.
4. **`persistVerifyCache(updates)` / `loadValidatedVerifyCache(runIdentity)`** — the store's cache
   methods: `load` validates exact check input + base/candidate state + workflow source hash +
   runtime generation BEFORE any reuse and fails closed (no valid receipt → fresh dispatch);
   persistence is atomic and a failed write leaves the store unchanged. The execute-milestone
   callsites are B3/B4's, not B2b's.
5. **CLI** — `--append-stage`, `--persist-verify-cache`, `--load-validated-verify-cache`, plus
   embedded `--selftest`/`--json`.

**WIRING-CLAIM (B2b-JOURNAL-STORE):** `workflow-journal.ts` persists `stage-journal.jsonl` +
`receipts/*.json` under the canonical milestone root resolved via `milestoneRootRel`; atomic write;
torn/partial trailing record surfaced, never silently parsed; `persistVerifyCache`/
`loadValidatedVerifyCache` ship as store methods with fail-closed load. → AC5.

## Acceptance Criteria

- [ ] `workflow-journal.ts` persists `stage-journal.jsonl` + `receipts/*.json` under the canonical
  milestone root resolved via `parseMilestoneNum`/`milestoneRootRel` (no second path convention; the
  `>= 130` literal is absent from B2b's TS).
- [ ] Atomic write + torn-write rejection: a partial trailing record is surfaced on read, never
  silently parsed; no partial-success state is observable.
- [ ] `persistVerifyCache`/`loadValidatedVerifyCache` ship as store methods with fail-closed load (no
  valid receipt → fresh dispatch) and RED/GREEN contract tests.
- [ ] The store creates `milestones/M276` if absent; journal + receipts survive a process/session
  restart.
- [ ] Both mirrors byte-identical (`diff` exit 0); tests RED/GREEN per `scripts/test.sh`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real dispatch writes a `stage-journal.jsonl` + at least one receipt that survive a
  process/session restart and re-validate (real dispatch evidence, on `milestones/M276/`).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/workflow-journal.ts`
- `plugin/scripts/workflow-journal.ts`
- `experiments/quay-perpetual-stream/test/*workflow-journal*`
- `plugin/test/*workflow-journal*`
- `docs/plans/M276-dir-124-b2b.md`
`milestones/M276/preparation.json`
`milestones/M276/proposal-ledger.json`
`milestones/M276/stage-journal.jsonl`
`milestones/M276/receipts/*.json`
`tasks/DIR-124-B2b.md`
`.quay/config.yml`

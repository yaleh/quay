---
id: DIR-124-F3c
title: "Close task-schema mirror drift (task-schema*.ts/.sh/.test across mirrors)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-124-F3
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-F3 (M259, ProposalReview disposition `split-recommended` /
`split-multi-mechanism`) — **closing the task-schema mirror drift**. The `experiments/` and
`plugin/` mirrors of the task-schema family are NOT byte-identical (verified at base):
`task-schema.ts`, `task-schema-check.ts`, and `task-schema-check.sh` differ between mirrors;
`task-schema-selfcheck.sh` and `task-schema.test.mjs` exist only in the `experiments/` mirror. This
child reconciles every task-schema file to byte-identical across mirrors so the hygiene gate
(template hygiene / Touches parsing) is enforced identically on both packaging paths.

### Chosen mechanism

1. **Reconcile each diverging script** — `task-schema.ts`, `task-schema-check.ts`,
   `task-schema-check.sh` are reconciled to byte-identical across `experiments/` and `plugin/`
   mirrors (the `experiments/` copy is the canonical source; the `plugin/` copy is the mirror).
2. **Add missing plugin/ copies** — `plugin/scripts/task-schema-selfcheck.sh` (mirror of the
   experiments selfcheck) and `plugin/test/task-schema.test.mjs` (mirror of the experiments test)
   are created byte-identical.
3. **Real dispatch evidence (folded in)** — per the parent split review, the
   `F3-REAL-DISPATCH-EVIDENCE` mechanism is not independently shippable; its evidence obligation is
   folded into this leaf's DoD: one real preflight/prepare run exercises the reconciled
   task-schema module on the plugin path.

**WIRING-CLAIM (F3c-MIRROR-DRIFT-CLOSE):** all `task-schema*` scripts/tests are byte-identical
across the `experiments/` and `plugin/` mirrors (`diff` exit 0 per file) and both
`task-schema-selfcheck.sh` + `task-schema.test.mjs` exist in both mirrors. → AC1: mirror parity on
the task-schema family.

## Acceptance Criteria

- [ ] `diff` exits 0 for `task-schema.ts`, `task-schema-check.ts`, `task-schema-check.sh`,
  `task-schema-selfcheck.sh`, and `task-schema.test.mjs` across the two mirrors.
- [ ] `plugin/scripts/task-schema-selfcheck.sh` and `plugin/test/task-schema.test.mjs` exist and are
  byte-identical to their `experiments/` counterparts.
- [ ] No task-schema behavior changes outside the reconciliation (the reconciled content is the
  canonical behavior; only the drifting mirror copy changes).
- [ ] Tests GREEN per `scripts/test.sh`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real preflight/prepare run exercises the reconciled task-schema module on the plugin
  mirror path (real dispatch evidence — the folded-in `F3-REAL-DISPATCH-EVIDENCE` obligation).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/task-schema.ts`
- `plugin/scripts/task-schema.ts`
- `experiments/quay-perpetual-stream/scripts/task-schema-check.ts`
- `plugin/scripts/task-schema-check.ts`
- `experiments/quay-perpetual-stream/scripts/task-schema-check.sh`
- `plugin/scripts/task-schema-check.sh`
- `experiments/quay-perpetual-stream/scripts/task-schema-selfcheck.sh`
- `plugin/scripts/task-schema-selfcheck.sh`
- `experiments/quay-perpetual-stream/test/task-schema.test.mjs`
- `plugin/test/task-schema.test.mjs`
- `docs/plans/M269-dir-124-f3c.md`
`milestones/M269/preparation.json`
`milestones/M269/proposal-ledger.json`
`milestones/M269/stage-journal.jsonl`
`milestones/M269/receipts/*.json`
`tasks/DIR-124-F3c.md`
`.quay/config.yml`

---
id: DIR-124-F4b
title: "Seeded ground-truth registry data (ground-truth-registry.json)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-124-F4
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from DIR-124-F4 (M260, ProposalReview disposition `split-recommended` /
`split-multi-mechanism`) — the **seeded registry data file**. This child owns
`experiments/quay-perpetual-stream/scripts/ground-truth-registry.json` (byte-identical mirror at
`plugin/scripts/ground-truth-registry.json`): seeded with **at least one fact per category across
all 8 categories**, with the `evidence-surface` category seeded from `inherited-core.md`'s
`evidenceSurface` content. The data file is the single production owner of repo-invariant facts; the
TS module (F4-M1) validates it.

### Chosen mechanism

1. **`ground-truth-registry.json` (both mirrors)** seeded with `>=1` fact per category for all 8
   categories (`cli-paths`, `coverage-format`, `touches-matching`, `provider-defaults`,
   `module-signatures`, `evidence-surface`, `subprocess`, `gate-resolution`).
2. **`evidence-surface` seeding** — facts in that category come from `inherited-core.md`'s
   `evidenceSurface` (journal.jsonl `{type:"started"|"result", key:"v2:<hash>", agentId[,
   result]}` vs `workflows/wf_*.json` `workflowProgress[]`), with `adrRef` pointing to the deciding
   ADR where applicable.
3. **Validate against the F4-M1 module** — the seeded data passes `ground-truth-registry.ts
   --validate` (schema + category whitelist + content hash).

**WIRING-CLAIM (F4b-SEEDED-DATA):** `ground-truth-registry.json` (both mirrors) carries `>=1` fact
per category across all 8 categories with `evidence-surface` seeded from `inherited-core.md`, and
`--validate` on the seeded data exits 0 (schema + category whitelist + hash). → AC1: seeded,
schema-validated, versioned, hash-bound registry data.

## Acceptance Criteria

- [ ] The JSON data file has `>=1` fact per category, all 8 categories represented.
- [ ] The `evidence-surface` category is seeded from `inherited-core.md`'s `evidenceSurface`
  content (with `adrRef` where applicable).
- [ ] `ground-truth-registry.ts --validate` on the seeded data exits 0 (schema + category whitelist
  + content hash).
- [ ] Both mirrors byte-identical (`diff` exit 0); tests RED/GREEN per `scripts/test.sh`.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real `--validate` on the seeded registry passes with all 8 categories represented (real CLI
  evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/ground-truth-registry.json`
- `plugin/scripts/ground-truth-registry.json`
- `experiments/quay-perpetual-stream/inherited-core.md`
- `docs/plans/M271-dir-124-f4b.md`
- `milestones/M271/preparation.json`
- `milestones/M271/proposal-ledger.json`
- `milestones/M271/stage-journal.jsonl`
- `milestones/M271/receipts/*.json`
- `tasks/DIR-124-F4b.md`
- `.quay/config.yml`

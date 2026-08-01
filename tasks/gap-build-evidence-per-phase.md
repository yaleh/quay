---
id: gap-build-evidence-per-phase
title: "Per-phase evidence consumption (collector consumes perPhaseEvidenceFile/iterationReport)"
status: todo
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: gap-build-evidence-manifest-missing
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from gap-build-evidence-manifest-missing (M238) — mechanism 2, **per-phase evidence
consumption**. The collector currently accepts `--per-phase-evidence` (composite path) and
`--iteration-report` (width-1 path) CLI flags (collector lines 365-366) but does NOT consume their
contents: `collectBuildEvidence` destructures `perPhaseEvidenceFile` and `iterationReport` (lines
196-197) yet `reconcileEvidence(plannedAcEvidence, [])` always reconciles against an EMPTY
`actualRows` array — the per-phase evidence / iteration report never reaches the `acEvidence` rows.
Singleton and composite paths are "unified" in name only.

### Chosen mechanism

Make the collector actually consume the per-phase evidence inputs so composite and width-1 paths
produce the same `BuildEvidenceManifest` schema (version "1") with real `acEvidence` rows:

1. **Consume `--per-phase-evidence <file>`** — read the `PhaseEvidence[]` JSON, map each entry into an
   `acEvidence` row (with `producer` provenance: mechanical vs build-agent), and reconcile
   `plannedAcEvidence` against these actual rows (1:1 by `{taskId, acIndex}`).
2. **Consume `--iteration-report <file>`** — for the width-1 path, read the iteration report
   (`iteration-0.md`) and map its evidence claims into `acEvidence` rows the same way, tagging
   `producer` provenance.
3. **Reconcile real rows** — `reconcileEvidence(plannedAcEvidence, actualRows)` is called with the
   consumed per-phase rows (not `[]`), so a planned row with a matching per-phase evidence row is
   dispositioned as matched rather than `unmet` (`planned-ac-unmatched` false-positive eliminated).
4. **CLI wiring** — the workflow Build-Evidence phase passes the composite per-phase evidence file
   (`/tmp/composite-build-evidence-<M>-<T>.json`) or the width-1 iteration report through to the
   collector flags, and the collector honors them.

**WIRING-CLAIM (BE-PER-PHASE):** the collector consumes `perPhaseEvidenceFile` (composite) and
`iterationReport` (width-1) into real `acEvidence` rows with producer provenance, and
`reconcileEvidence` reconciles planned vs actual using those rows — the same schema for both paths. →
AC1/AC4/AC5 (unified schema, producer provenance, evidence-class compatibility).

## Acceptance Criteria

- [ ] `--per-phase-evidence <file>` contents are read into `acEvidence` rows with `producer`
  provenance; a planned row with a matching per-phase row is dispositioned matched, not `unmet`.
- [ ] `--iteration-report <file>` (width-1 path) contents are consumed into `acEvidence` rows the same
  way.
- [ ] `reconcileEvidence(plannedAcEvidence, [])` empty-array call is removed; reconciliation uses the
  consumed per-phase rows (1:1 by `{taskId, acIndex}`).
- [ ] Both singleton and composite paths produce the same `BuildEvidenceManifest` schema (version "1")
  with populated `acEvidence` (no `planned-ac-unmatched` false positive on a matching per-phase row).
- [ ] Both mirrors byte-identical (`diff` exit 0); tests RED/GREEN per `scripts/test.sh`; existing
  build-evidence tests stay GREEN.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] One real composite dispatch and one real width-1 dispatch each emit a manifest whose `acEvidence`
  rows come from the consumed per-phase evidence / iteration report (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts`
- `plugin/scripts/build-evidence-collector.ts`
- `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts`
- `plugin/scripts/build-evidence-manifest.ts`
- `experiments/quay-perpetual-stream/test/*build-evidence*`
- `plugin/test/*build-evidence*`
- `docs/plans/M264-gap-build-evidence-per-phase.md`
- `milestones/M264/preparation.json`
- `milestones/M264/proposal-ledger.json`
- `milestones/M264/stage-journal.jsonl`
- `milestones/M264/receipts/*.json`
- `tasks/gap-build-evidence-per-phase.md`
- `.quay/config.yml`

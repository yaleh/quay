---
id: gap-discovery-evidence-level-teaching-vs-independent
title: "Evidence levels (teaching/transfer/independent/production-open): only
  independent verdicts promote; quarantined lineages cannot be revived by lower
  levels"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion
---
## Proposal
Point 4 of the 2026-10-12 strategy change:
- Teaching and transfer cases may use known answers, but their evidence level must be labelled precisely.
- Strict cross-experiment exclusion applies only to independent-generalization experiments.
- Lineage and temporal honesty stay. A repeated training case must never be presented as an independent proof.
- The two methods promoted on contaminated holdouts must never be revived through a lower evidence level:
  - `shared-contract-divergence` (v6, retired as v7 `method-f22f31cfe3029259`);
  - `multi-writer-guard-equivalence` (v2, retired as v3 `method-c93d704b1a124ed2`).

Today the Experience ledger, the generalization verdicts and the method registry carry no evidence level. A verdict on a teaching case and a verdict on a sealed independent case look the same to the promotion guard.

## Plan
1. Add a required `evidence_level` ∈ `teaching | transfer | independent | production-open` to new Experience records, generalization verdicts and method promotion evidence. Legacy records read as `unlabelled`, which is never `independent`.
2. Promotion to `active` requires ≥1 verdict with `evidence_level:"independent"` that passed the global case-identity/anti-leak checks (from `gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion`). Teaching or transfer verdicts can move a method to a new `status:"trial"` state at most. `trial` is report-only, never executed as active, and never shown as generalization.
3. A method whose lineage contains a retirement reason starting `QUARANTINE` can be re-promoted only by an `independent` verdict whose held-out case shares no component set with ANY case behind the quarantined promotion. Lower levels are refused (`QUARANTINED_LINEAGE_NEEDS_INDEPENDENT`).
4. The strict cross-experiment exclusion runs only for `independent`. `teaching` and `transfer` may reuse known cases but must name the source case in the record, and they are excluded from every independent metric.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-reflection.test.mjs plugin/test/discovery-method-registry.test.mjs plugin/test/discovery-experience-ledger.test.mjs` exits 0, with new cases:
  - (a) a teaching-level correct verdict cannot reach `active` (at most `trial`);
  - (b) an `unlabelled` legacy verdict is never `independent`;
  - (c) `shared-contract-divergence` re-promotion with a transfer verdict ⇒ `QUARANTINED_LINEAGE_NEEDS_INDEPENDENT`;
  - (d) a transfer verdict reusing a known case is accepted at transfer level and names its source;
  - (e) `activeMethods()` never returns `trial` methods.
- [ ] Real check: a no-model replay of a transfer-level verdict for `shared-contract-divergence` is refused for active. Paste the refusal and `activeMethods()` = `[]`.
- [ ] Mutation control: allow `transfer` to promote to `active`, and show cases (a) and (c) go red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-evidence-level-teaching-vs-independent` green.

## Touches
- tasks/gap-discovery-evidence-level-teaching-vs-independent.md
- docs/analysis/discovery-reflection.mjs
- docs/analysis/discovery-method-registry.mjs
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-reflection.test.mjs
- plugin/test/discovery-method-registry.test.mjs
- plugin/test/discovery-experience-ledger.test.mjs

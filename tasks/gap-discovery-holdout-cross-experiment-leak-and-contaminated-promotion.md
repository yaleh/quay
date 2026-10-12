---
id: gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion
title: "Discovery Method: holdouts reused across experiments promoted two
  methods; exclusion must span every sealed set and seeds, and contaminated
  verdicts must never license promotion"
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
The done task `gap-discovery-method-generalization-failures-diagnosis-and-retest` promoted two methods to `active` (`shared-contract-divergence@6`, `multi-writer-guard-equivalence@2`) on a "new" sealed holdout, `/data/home/yale/work/quay-scratch/dm-holdout2/labels-dt2-sealed.json` (sha256 `2e041979…`, 9 cases). An operator overlap check on 2026-10-12 showed 8 of the 9 cases were not new:
- `HX2-fan-in-lock-hold-key` and `HX2-per-task-suite-record-required-fields` are teaching or seed cases (the latter is the seed of `shared-contract-divergence` v1).
- `HX2-doc-check-cache-vs-scoped-gate-cache`, `HX2-isDirectInvocation-pair`, `HX2-splitArgs-isNonNegInt-trio` and `HX2-NEG-shell-walk-skipset` reuse `E-HYPGEN-AB-1` holdouts (`/data/home/yale/work/quay-scratch/ab1/labels-ab-sealed.json`).
- `HX2-ac69-exit3-nonfatal` is derived from the public diagnostic C5.
- `HX2-NEG-meta-driver-quality-gate` is the Probe/Meta case, mislabelled negative (the operator investigation `E-ARCH-PM-IDENTITY` supported it).

The exclusion set used only dt1's 11 cases plus seed provenance (that task's caveat 2). The lineage check matches by Experience id only (caveat 5).

Both methods were retired by the operator on 2026-10-12 (registry `method-f22f31cfe3029259` v7, `method-c93d704b1a124ed2` v3; `activeMethods()` = 0). But the promotion guard still accepts the contaminated verdicts: `generalization_verdict-6f30e7c33140a0d3` and `generalization_verdict-1cd37e089b5e6da5` record `correct:true` and pass the lineage and temporal checks. A re-promotion citing them would succeed.

## Plan
1. **Exclusion registry.** A pure builder `buildHoldoutExclusion(root, { sealedSets, ... })` collects, as component-sets plus fix commits plus case ids:
   - every sealed label file under the scratch experiment roots (enumerated, not hard-coded per case: glob `*/labels*sealed*.json` under `/data/home/yale/work/quay-scratch/`, passed as a path argument);
   - every Experience in the ledger used as a seed by any registry method;
   - every case marked `diagnostic-public` in any sealed file.
2. **Pre-model refusal.** `validateGeneralization` refuses a held-out case before any model call (`HELD_OUT_PREVIOUSLY_USED`) when it shares ≥2 components with any excluded case, shares a fix commit, or reuses a case id. A whole sealed set with any such collision is refused at pre-registration (`SEALED_SET_CONTAMINATED`), listing the colliding cases.
3. **Lineage by component set.** `checkLineageIsolation` matches on component sets (≥2 shared files) across the whole lineage, in addition to Experience id.
4. **Contaminated-verdict ledger.** An append-only `.quay/discovery-contaminated-verdicts.jsonl` (persistent shared-checkout carrier) with `{verdict_id, reason, evidence, authored_by}`. The promotion guard refuses any `generalization_evidence` naming a listed verdict (`VERDICT_CONTAMINATED`). Backfill it with every verdict whose held-out case is in `labels-dt2-sealed.json` (compute the list from the verdict carrier; do not hand-pick ids). Each record states the collision found.
5. No method is promoted by this task. `activeMethods()` must remain 0 at the end.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-reflection.test.mjs plugin/test/discovery-method-registry.test.mjs` exits 0, with new cases:
  - (a) a held-out case sharing 2 components with a case in another sealed file ⇒ `HELD_OUT_PREVIOUSLY_USED`, zero model calls;
  - (b) a sealed set containing one such case ⇒ `SEALED_SET_CONTAMINATED`, listing it;
  - (c) lineage isolation refuses a same-component case under a different Experience id;
  - (d) promotion citing a listed verdict ⇒ `VERDICT_CONTAMINATED`;
  - (e) a genuinely unseen case (no shared pair, no shared fix commit) is accepted.
- [ ] Real check against `labels-dt2-sealed.json` with the real sealed files and ledger. Paste the per-case collision table:
  - which of the 9 collide, with what (file and case id);
  - expected: at least the 8 cases named in the Proposal;
  - `HX2-NEG-runner-concurrency-twin`: report honestly whether it collides with anything.
  Paste the resulting `SEALED_SET_CONTAMINATED` refusal.
- [ ] Real backfill: paste the contaminated-verdict records written (count and ids). Then show a re-promotion attempt of `shared-contract-divergence` citing `generalization_verdict-6f30e7c33140a0d3` being refused with `VERDICT_CONTAMINATED`. Paste `activeMethods()` = 0.
- [ ] Static: no sealed-case id or held-out component basename in the changed production files. Paste the `grep` output.
- [ ] Mutation control: drop the cross-sealed-set component collision and show case (a) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion` green.

## Touches
- tasks/gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion.md
- docs/analysis/discovery-reflection.mjs
- docs/analysis/discovery-method-registry.mjs
- plugin/test/discovery-reflection.test.mjs
- plugin/test/discovery-method-registry.test.mjs

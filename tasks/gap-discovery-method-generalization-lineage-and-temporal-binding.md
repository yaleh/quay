---
id: gap-discovery-method-generalization-lineage-and-temporal-binding
title: "Discovery Method: held-out generalization must exclude the whole method
  lineage and bind expected labels to an evaluation pin"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
Read-only audit (2026-10-12) of the landed Phase 2 (`docs/analysis/discovery-reflection.mjs`, done task `gap-discovery-method-reflection-unified-trigger-and-candidate-generation`) found its only "generalization pass" invalid on two independent grounds:
1. **Lineage leak.** `validateGeneralization` refuses a held-out case only if its id is in the candidate VERSION's own `provenance_evidence` (around line 581). `shared-contract-divergence` v1 was seeded from evidence-store record `outcome-bb12a6858838e74b` (REQUIRED_FIELDS), v3 of the same method was produced from the REQUIRED_FIELDS Experience in the same round, yet v2 was "validated" against that same REQUIRED_FIELDS Experience and promoted to `active`.
2. **Temporal mismatch.** The verifier read develop `9a329772a`, where the REQUIRED_FIELDS fix (`706545794`) had already landed (`per-task-suite-record-check.ts:69` imports `REQUIRED_FIELDS`). By the method's own invariant the correct reading of that code is "invariant holds" (refuted); the verifier answered `supported` and was graded "correct" only because the expected verdict came from the case's historical role (`found-and-fixed`), not from the code evaluated.

## Plan
1. **Lineage isolation.** A held-out Experience is refused (`HELD_OUT_SHARES_LINEAGE`) if ANY of these holds across the candidate's whole lineage — every recorded version of its `method_id`, plus every method it extends/composes (`method:<id>@<v>` refs in provenance):
   - the held-out's `id` or `source_ref` appears in any lineage version's `provenance_evidence`, or in the `provenance_evidence`/`source_ref` of any Experience those reference;
   - the held-out's `components` share ≥2 files with any lineage seed Experience's `components` (same defect, different record).
2. **Temporal binding.** A held-out case must carry `evaluation_pin` (a commit at which its expected verdict is true) and, for positive cases, `fix_commit`.
   - `validateGeneralization` refuses (`NO_EVALUATION_PIN`) without a pin, and refuses (`TEMPORAL_MISMATCH`) if `fix_commit` is an ancestor of `evaluation_pin`.
   - The verifier runs in a STRIPPED detached tree at `evaluation_pin` (no `.quay tasks goals docs orchestration experiments meta archive milestones measurements adr`), reusing the stripped-pin discipline of `docs/analysis/arch-hypothesis-generation.mjs`, never the live checkout.
   - The evaluated commit is recorded on the verdict.
3. Refusals are recorded as `not-evaluated` with their reason, never as a failed method (硬规则 3b), and never promote.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-reflection.test.mjs` exits 0, with new cases:
  - (a) held-out whose `source_ref` is in an EARLIER version's provenance ⇒ `HELD_OUT_SHARES_LINEAGE`;
  - (b) held-out sharing ≥2 components with a lineage seed but a different record ⇒ refused;
  - (c) held-out from an unrelated lineage ⇒ accepted;
  - (d) missing `evaluation_pin` ⇒ `NO_EVALUATION_PIN`;
  - (e) `fix_commit` ancestor of `evaluation_pin` ⇒ `TEMPORAL_MISMATCH`;
  - (f) the verifier cwd is a stripped tree at the pin (assert absent `tasks/`, `.quay/`) and the verdict records the evaluated commit.
- [ ] Real replay of the invalid promotion: reconstruct `shared-contract-divergence` v1 (provenance `outcome-bb12a6858838e74b`) and v2 (provenance = the fan-in lock Experience) from the evidence pasted in the Phase 2 task, and call `validateGeneralization` with the REQUIRED_FIELDS Experience as held-out. Paste the refusal (`HELD_OUT_SHARES_LINEAGE`, zero model calls). Then re-run with `evaluation_pin` = develop and `fix_commit` = `706545794` against a non-lineage method and paste `TEMPORAL_MISMATCH`.
- [ ] Mutation control: reduce the lineage check back to "this version's provenance only" and show case (a) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-method-generalization-lineage-and-temporal-binding` green.

## Touches
- tasks/gap-discovery-method-generalization-lineage-and-temporal-binding.md
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-reflection.test.mjs

---
id: gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion
title: "P0 Discovery Method: global case-identity anti-leak index before
  pre-registration; refuse reused holdouts across
  experiments/methods/teaching/diagnostics; contaminated verdicts never license
  promotion"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
**P0 (user, 2026-10-12).** Two methods were promoted on contaminated holdouts, and the hidden-case exclusion has to be rebuilt so that cannot happen again.

**Already done by the operator, read-only verified at 12:51Z:**
- `shared-contract-divergence` latest = v7 retired (`method-f22f31cfe3029259`).
- `multi-writer-guard-equivalence` latest = v3 retired (`method-c93d704b1a124ed2`).
- `activeMethods()` = `[]`.
- No production code executes a method because it is `active`: the only non-test method-status read is a promotion counter (`plugin/scripts/discovery-method-routine.ts` around line 690).

The remaining risk is RE-promotion and a recurrence of the leak.

**What happened.** The done task `gap-discovery-method-generalization-failures-diagnosis-and-retest` promoted `shared-contract-divergence@6` and `multi-writer-guard-equivalence@2` on `/data/home/yale/work/quay-scratch/dm-holdout2/labels-dt2-sealed.json` (sha256 `2e041979…`). An operator overlap check found 8 of its 9 cases previously used:
- teaching/seed: `HX2-fan-in-lock-hold-key`, `HX2-per-task-suite-record-required-fields`, the latter being the seed of `shared-contract-divergence` v1;
- earlier `E-HYPGEN-AB-1` holdouts (`/data/home/yale/work/quay-scratch/ab1/labels-ab-sealed.json`): `HX2-doc-check-cache-vs-scoped-gate-cache`, `HX2-isDirectInvocation-pair`, `HX2-splitArgs-isNonNegInt-trio`, `HX2-NEG-shell-walk-skipset`;
- derived from the public diagnostic C5: `HX2-ac69-exit3-nonfatal`;
- the Probe/Meta case, mislabelled negative: `HX2-NEG-meta-driver-quality-gate`.

**Why the checks missed it:**
- The exclusion set held only dt1's 11 cases plus seed provenance.
- Lineage matched by Experience id only.
- The promotion guard still accepts the contaminated verdicts (`generalization_verdict-6f30e7c33140a0d3`, `generalization_verdict-1cd37e089b5e6da5`), which record `correct:true`.

## Plan
1. **Global case identity / provenance index**, built BEFORE any pre-registration. A pure `buildCaseIdentityIndex(root, { sealedSetPaths })` covers:
   - every sealed label file (glob `*/labels*sealed*.json` under `/data/home/yale/work/quay-scratch/`, passed as an argument, never hard-coded per case);
   - every Experience used as a seed by ANY method, at ANY version, across ALL methods and their `extends`/`composes` lineage;
   - every Experience in the ledger, including teaching and user cases;
   - every case marked `diagnostic-public` in any sealed file;
   - every held-out case named in `.quay/discovery-generalization-verdicts.jsonl`.

   Each entry records: component set (basenames), fix commit(s), case id, source file or carrier and line, first-use experiment. The index is written to the persistent shared-checkout carrier `.quay/discovery-case-identity-index.json` with its own sha256.
2. **Pre-registration refusal.**
   - A new sealed set is refused (`SEALED_SET_CONTAMINATED`, zero model calls) if ANY case collides with the index: ≥2 shared components, a shared fix commit, or a reused case id. The refusal lists every collision with its source.
   - `validateGeneralization` repeats the check per case (`HELD_OUT_PREVIOUSLY_USED`) as defence in depth.
3. **Lineage across all versions and methods:** match on component sets (≥2 shared) across the full lineage, in addition to Experience id.
4. **Binding new cases to their pin and result.**
   - A new sealed case must carry `evaluation_pin` and, for positives, `fix_commit` (descending from the pin), plus `labeled_by` (an independent-labeler session/agent id) and `labeled_at`.
   - `labeled_at` must precede the pre-registration mtime, which must precede the first model call. The verdict records the pin, the label sha and the index sha it was checked against.
5. **Contaminated-verdict ledger.**
   - An append-only `.quay/discovery-contaminated-verdicts.jsonl` holds `{verdict_id, reason, collisions, authored_by}`. Backfill every verdict whose held-out case is in `labels-dt2-sealed.json`, computed from the verdict carrier, not hand-picked.
   - The promotion guard refuses `generalization_evidence` naming a listed verdict (`VERDICT_CONTAMINATED`).
   - `activeMethods()` excludes any method whose promoting verdict is listed and reports it as `excluded_contaminated` (defence in depth).
6. **No scoring change and no promotion relaxation.** The correctness rule and the gates are unchanged. This task promotes nothing; `activeMethods()` stays `[]`.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-reflection.test.mjs plugin/test/discovery-method-registry.test.mjs` exits 0. All new cases use stub models and assert 0 model calls:
  - (a) a case sharing 2 components with a case in a DIFFERENT sealed file ⇒ `HELD_OUT_PREVIOUSLY_USED`;
  - (b) a case sharing only a fix commit ⇒ refused;
  - (c) a case matching an earlier version's seed of a DIFFERENT method's lineage ⇒ refused;
  - (d) a sealed set with one colliding case ⇒ `SEALED_SET_CONTAMINATED`, listing it;
  - (e) a genuinely unseen case (no shared pair, fix or id) ⇒ accepted;
  - (f) promotion citing a listed verdict ⇒ `VERDICT_CONTAMINATED`;
  - (g) `activeMethods()` excludes a method promoted on a listed verdict;
  - (h) a new case with `labeled_at` after the prereg mtime ⇒ refused.
- [ ] **Forced-refusal replay, real, zero model calls.** Build the index from the real sealed files and carriers, then attempt pre-registration of `labels-dt2-sealed.json`. Paste:
  - the `SEALED_SET_CONTAMINATED` refusal;
  - the per-case collision table, which must flag at least the 8 cases named above, each with the colliding source;
  - an honest report on `HX2-NEG-runner-concurrency-twin`.
- [ ] **Deliberate-contamination counterexamples, real, zero model calls:**
  - (i) copy one real `ab1` holdout case into a fresh sealed fixture under a NEW case id and refuse it via component collision;
  - (ii) rename its files' directory only (same basenames) and refuse it;
  - (iii) change one of its two files to an unrelated file and show it is ACCEPTED (control: the rule is not "refuse everything").

  Paste all three.
- [ ] **Real backfill:** paste the contaminated-verdict records (count and ids), a refused re-promotion of `shared-contract-divergence` citing `generalization_verdict-6f30e7c33140a0d3` (`VERDICT_CONTAMINATED`), and `activeMethods()` = `[]`.
- [ ] Static: no sealed-case id or held-out component basename appears in the changed production files. Paste the `grep`.
- [ ] Mutation control: drop the cross-sealed-set component collision and show cases (a) and (i) go red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion` green.
- No model call was made by this task.

## Touches
- tasks/gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion.md
- docs/analysis/discovery-reflection.mjs
- docs/analysis/discovery-method-registry.mjs
- plugin/test/discovery-reflection.test.mjs
- plugin/test/discovery-method-registry.test.mjs

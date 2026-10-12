---
id: gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion
title: "P0 Discovery Method: global case-identity anti-leak index before
  pre-registration; refuse reused holdouts across
  experiments/methods/teaching/diagnostics; contaminated verdicts never license
  promotion"
status: done
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

**What was built (Plan items 1–5; item 6 unchanged — no scoring change, nothing promoted).**
- `docs/analysis/discovery-reflection.mjs`: `buildCaseIdentityIndex` / `writeCaseIdentityIndex` / `readCaseIdentityIndex` / `caseIndexSha256` / `readSealedSet` / `caseComponentsOf` / `fixCommitsOf` / `caseCollisions` / `checkSealedSetContamination` / `validateCaseLabelTiming` / `validateSealedSetBinding` / `caseLabelSha256`; `validateGeneralization` gains the `caseIdentityIndex` gate (`HELD_OUT_PREVIOUSLY_USED`) and the label-timing gate, and records `label_sha256` / `index_sha256` / `previously_used_ok` on the verdict.
- `docs/analysis/discovery-method-registry.mjs`: the contaminated-verdict carrier (`CONTAMINATED_VERDICTS_REL`), `appendContaminatedVerdict`, `backfillContaminatedVerdicts`, `contaminatedVerdictIds`; the promotion rule gains the `VERDICT_CONTAMINATED` cause and requires `previously_used_ok !== false`; `activeMethods` reports `excluded_contaminated`.
- One collision arm is deliberately WEAKER than the others: a single component shared with a case the sealed files mark `diagnostic-public` already refuses, because a case surfaced in the open reached the labeller through a channel no component identity can represent (this is the arm that catches the C5-derived case; it is spelled as its own kind, `shared_diagnostic_component`).

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-reflection.test.mjs plugin/test/discovery-method-registry.test.mjs` exits 0. All new cases use stub models and assert 0 model calls:
  - (a) a case sharing 2 components with a case in a DIFFERENT sealed file ⇒ `HELD_OUT_PREVIOUSLY_USED`;
  - (b) a case sharing only a fix commit ⇒ refused;
  - (c) a case matching an earlier version's seed of a DIFFERENT method's lineage ⇒ refused;
  - (d) a sealed set with one colliding case ⇒ `SEALED_SET_CONTAMINATED`, listing it;
  - (e) a genuinely unseen case (no shared pair, fix or id) ⇒ accepted;
  - (f) promotion citing a listed verdict ⇒ `VERDICT_CONTAMINATED`;
  - (g) `activeMethods()` excludes a method promoted on a listed verdict;
  - (h) a new case with `labeled_at` after the prereg mtime ⇒ refused.

  ```
  ℹ tests 81
  ℹ pass 81
  ℹ fail 0
  ```
  Every new case is present and green, and each refusal arm asserts `counter.calls === 0`:
  ```
  ✔ AC(a): a case sharing >= REQUIRED components with a case in a DIFFERENT sealed file ⇒ HELD_OUT_PREVIOUSLY_USED
  ✔ AC(b): a case sharing ONLY a fix commit with an indexed case ⇒ refused
  ✔ AC(c): a case matching an EARLIER version's seed of a DIFFERENT method's lineage ⇒ refused
  ✔ AC(d): a sealed set with ONE colliding case ⇒ SEALED_SET_CONTAMINATED naming it (zero model calls)
  ✔ AC(e): a genuinely unseen case is ACCEPTED — the rule is not 'refuse everything'
  ✔ AC(a-labels): a diagnostic-public case collides on ONE shared component — the public channel is not a component identity
  ✔ AC(h): a new case whose `labeled_at` FOLLOWS the pre-registration mtime ⇒ refused with zero model calls
  ✔ AC(binding): the sealed-set binding gate requires the pin, the labeller, the label time, and the order
  ✔ AC(labels-recorded): an evaluated verdict records the label sha and the index sha it was checked against
  ✔ AC(f): a promotion citing a VERDICT_CONTAMINATED verdict is refused — by the list AND by the carrier
  ✔ AC(f): an UNREADABLE contaminated ledger refuses the write — its own value, never a silent pass
  ✔ AC(g): `activeMethods` EXCLUDES a method whose promoting verdict is listed, and reports why
  ✔ AC(backfill): the ledger is BACKFILLED from the verdict carrier — every verdict on a listed case, none hand-picked
  ```
  One pre-existing assertion was WIDENED (not relaxed): the registry test pinned `PROMOTION_REFUSAL_CAUSES` to the five causes, and the contamination arm is a sixth cause of its own — reported as `VERDICT_NOT_PASSED` it would name the wrong defect.

- [x] **Forced-refusal replay, real, zero model calls.** Build the index from the real sealed files and carriers, then attempt pre-registration of `labels-dt2-sealed.json`. Paste:
  - the `SEALED_SET_CONTAMINATED` refusal;
  - the per-case collision table, which must flag at least the 8 cases named above, each with the colliding source;
  - an honest report on `HX2-NEG-runner-concurrency-twin`.

  Index over the five sources (the set under test EXCLUDED — the index must represent knowledge that predates it):
  ```
  INDEX built: {"entries":215,"cases":172,"diagnostic_public":14,"components":159}
  INDEX written: true /data/home/yale/work/quay/.quay/discovery-case-identity-index.json sha256= ca165e419f7cd7d6b0f260d2ab9e4956a8b3e5f988b27ee5202a801769fa9bd4
  INDEX read back: ok= true sha256_matches= true entries= 215
  ```
  The refusal (zero model calls — no model seam is constructed anywhere in the run):
  ```
  ok: false | refusal_code: SEALED_SET_CONTAMINATED | model_calls: 0 | evaluated: 9 | colliding_cases: 8
  SEALED_SET_CONTAMINATED:8-of-9-case(s)…HX2-fan-in-lock-hold-key[shared_components:EXP-31fc82ad5d6c1f86@ledger:.quay/discovery-experience-ledger.jsonl(fan-in-ff-protocol-check.ts,fan-in-queueing-model.ts)],HX2-per-task-suite-record-required-fields[shared_components:EXP-bb12a6858838e74b@ledger(per-task-suite-record-check.ts,per-task-suite-record.ts)],HX2-doc-check-cache-vs-scoped-gate-cache[shared_components:…@ledger + shared_components:HO-doc-check-cache-vs-scoped-gate-cache@sealed:…/ab1/labels-ab-sealed.json],HX2-isDirectInvocation-pair[shared_components:…@ledger + shared_components:HO-isDirectInvocation-pair@sealed:…/ab1/…],HX2-splitArgs-isNonNegInt-trio[shared_diagnostic_component:DIAG-POS-DRIVER-KIND@ab1 + shared_diagnostic_component:DIAG-POS-QUALITY-ROUND-WRITERS@ab1 + shared_components:HO-splitArgs-isNonNegInt-trio@ab1],HX2-ac69-exit3-nonfatal[shared_diagnostic_component:DIAG-POS-CHECKER-EXIT-NE-SPLIT@ab1 + shared_diagnostic_component:DIAG-C5-checker-exit-ne-split@dt1],HX2-NEG-shell-walk-skipset[shared_components:…@ledger + shared_components:HO-NEG-skipset-adr016-deadcode@ab1],HX2-NEG-meta-driver-quality-gate[12 collisions across ledger/ab1/dt1/hg-accept-run/hypgen/hypgen2]
  ```
  Per-case collision table (condensed; the full one is in the run output):
  ```
  HX2-fan-in-lock-hold-key      shared_components  [fan-in-ff-protocol-check.ts,fan-in-queueing-model.ts]  ← ledger:EXP-31fc82ad5d6c1f86
  HX2-per-task-suite-record-…   shared_components  [per-task-suite-record-check.ts,per-task-suite-record.ts]  ← ledger:EXP-bb12a6858838e74b
  HX2-doc-check-cache-…         shared_components  [doc-check-cache.ts,worker-fan-in.ts]  ← ledger ×2, ab1:HO-doc-check-cache-vs-scoped-gate-cache
  HX2-isDirectInvocation-pair   shared_components  [config-wiring-check.ts,drivable-workspace-check.ts]  ← ledger:EXP-bf5e7162f0cc0ba8, ab1:HO-isDirectInvocation-pair
  HX2-splitArgs-isNonNegInt-…   shared_components + shared_diagnostic_component  ← ab1:HO-splitArgs-isNonNegInt-trio, ab1:DIAG-POS-DRIVER-KIND, ab1:DIAG-POS-QUALITY-ROUND-WRITERS
  HX2-ac69-exit3-nonfatal       shared_diagnostic_component [ac69-slot-queue-gap-check.ts]  ← ab1:DIAG-POS-CHECKER-EXIT-NE-SPLIT, dt1:DIAG-C5-checker-exit-ne-split
  HX2-NEG-shell-walk-skipset    shared_components  [adr016-screen-use-check.ts,dead-code-after-return-check.ts]  ← ledger:EXP-90b57671d10f7ac0, ab1:HO-NEG-skipset-adr016-deadcode
  HX2-NEG-meta-driver-quality…  shared_components + shared_diagnostic_component  ← ledger, ab1 (×4), dt1, hg-accept-run (×2), hypgen (×2), hypgen2 (×2)
  HX2-NEG-runner-concurrency-twin : CLEAN (no collision)
  FLAGGED 8 of 9 cases.
  ```
  The flagged set is EXACTLY the 8 the operator's overlap check named. HONEST REPORT on the ninth, `HX2-NEG-runner-concurrency-twin` (role `holdout-negative`, components `[full-suite-runner.ts, runner-concurrency.ts]`, `fix_commit` null): it is NOT flagged, and the reason is a measurement rather than an absence — it overlaps **31** index entries (13 ledger Experiences, 15 registry-seed entries across 4 method versions, and 2 dt1 sealed cases) and every one of those overlaps is **exactly ONE** component (`full-suite-runner.ts` or `runner-concurrency.ts`, never both), it names no fix commit, and none of its components belongs to a `diagnostic-public` case. So on the operator's criteria the ninth case is genuinely unseen, and the table confirms it instead of assuming it. Its only "hit" would be `reused_case_id` against the two verdicts of its own contaminated run — which the gate deliberately does not count (a verdict written by the set under test's own run is not pre-existing knowledge; without that rule all nine would collide by case id and the component arms would never be the reason).

- [x] **Deliberate-contamination counterexamples, real, zero model calls:**
  - (i) copy one real `ab1` holdout case into a fresh sealed fixture under a NEW case id and refuse it via component collision;
  - (ii) rename its files' directory only (same basenames) and refuse it;
  - (iii) change one of its two files to an unrelated file and show it is ACCEPTED (control: the rule is not "refuse everything").

  Source case: real `ab1` `HO-pathCandidates-clone`, `["threshold-scope-check.ts","tick-core-static-check.ts"]`; each fixture below is a real sealed file on disk with the NEW id `CASE-holdover-copy-1`.
  ```
  --- i-new-case-id-same-files
      components: ["threshold-scope-check.ts","tick-core-static-check.ts"]
      refusal_code: SEALED_SET_CONTAMINATED   ok: false   model_calls: 0
      SEALED_SET_CONTAMINATED:1-of-1-case(s)…CASE-holdover-copy-1[shared_components:EXP-796ef27cbdba6996@ledger(threshold-scope-check.ts,tick-core-static-check.ts)+shared_components:HO-pathCandidates-clone@sealed:…/ab1/labels-ab-sealed.json(threshold-scope-check.ts,tick-core-static-check.ts)]
  --- ii-directory-renamed-only
      components: ["threshold-scope-check.ts","tick-core-static-check.ts"]      ← plugin/some-other-directory/…
      refusal_code: SEALED_SET_CONTAMINATED   ok: false   model_calls: 0
  --- iii-one-file-unrelated
      components: ["threshold-scope-check.ts","zz-unrelated-nonexistent-file.ts"]
      refusal_code: null   ok: true   model_calls: 0

  === VERDICTS ===
  PASS  (i)   new case id, same files        ⇒ REFUSED  (ok=false, expected false)
  PASS  (ii)  same basenames, dir renamed    ⇒ REFUSED  (ok=false, expected false)
  PASS  (iii) one file swapped, unrelated    ⇒ ACCEPTED (ok=true, expected true)
  ```
  (ii) is the arm that makes the identity a BASENAME identity: the same two files re-filed under another directory are the same case.

- [x] **Real backfill:** paste the contaminated-verdict records (count and ids), a refused re-promotion of `shared-contract-divergence` citing `generalization_verdict-6f30e7c33140a0d3` (`VERDICT_CONTAMINATED`), and `activeMethods()` = `[]`.

  ```
  SEALED SET: 9 cases | pre-registration refusal: SEALED_SET_CONTAMINATED (colliding: 8) | index sha256 = ca165e419f7cd7d6b0f260d2ab9e4956a8b3e5f988b27ee5202a801769fa9bd4

  === BACKFILL ===
  ok: true | verdicts examined: 21 | selected: 17 | appended: 17 | duplicates: 0
  carrier: /data/home/yale/work/quay/.quay/discovery-contaminated-verdicts.jsonl
  COUNT: 17
  VERDICT IDS:
  ["generalization_verdict-b338d3a8f19ca665","generalization_verdict-4050ce16524d3574","generalization_verdict-8cc6abac43ccde52","generalization_verdict-26fec291ede621cf","generalization_verdict-eb9e3e2123a0858e","generalization_verdict-2a08de967211e7a8","generalization_verdict-1996f71306e2bb00","generalization_verdict-6f30e7c33140a0d3","generalization_verdict-301777b79992f629","generalization_verdict-4b392bfe6c93f5b7","generalization_verdict-1cd37e089b5e6da5","generalization_verdict-a67b0ab4de81564a","generalization_verdict-79d1148c48729dd7","generalization_verdict-a2c0fd251ff422b9","generalization_verdict-5bb458dcbff5d5bf","generalization_verdict-bd8997ffdb9c078a","generalization_verdict-4883af161d95ae85"]
  RE-RUN: appended = 0 | duplicates = 17 | carrier lines = 17

  === REFUSED RE-PROMOTION: shared-contract-divergence citing generalization_verdict-6f30e7c33140a0d3 ===
  record: {"method_id":"shared-contract-divergence","version":8,"status":"active","verdict_ref":"generalization_verdict-6f30e7c33140a0d3"}
  appended: false | ok: false
  reasons: ["PROMOTION_WITHOUT_VALID_GENERALIZATION:VERDICT_CONTAMINATED:generalization_verdict-6f30e7c33140a0d3-is-listed-in-.quay/discovery-contaminated-verdicts.jsonl-as-judged-on-a-hold-out-that-had-already-been-used-so-it-cannot-license-a-promotion"]

  === activeMethods() ===
  {"ok":true,"methods":[],"evaluated":5,"excluded_contaminated":[],"contaminated_verdicts_evaluated":17}
  contaminatedVerdictIds ok: true | size: 17
  PASS/FAIL: PASS
  ```
  The 17 ids are EVERY verdict of the 21 recorded whose held-out case belongs to the refused set (the two methods' 15, plus the two for `HX2-NEG-runner-concurrency-twin`) — selected by the backfill from the verdict carrier, never typed. The 4 verdicts NOT listed are the dt1-era ones, whose held-out cases are not in this set. Same backfill re-run ⇒ 0 appended / 17 duplicates. No method is active; `shared-contract-divergence` v7 and `multi-writer-guard-equivalence` v3 remain retired, and the re-promotion of v8 is refused on the contaminated verdict (not on the lineage/temporal arms it also happens to fail).

- [x] Static: no sealed-case id or held-out component basename appears in the changed production files. Paste the `grep`.
  ```
  tokens: 54 sealed-case ids, 70 component basenames   (DERIVED from every */labels*sealed*.json + the verdict carrier)
  --- changed production files ---
     discovery-reflection.mjs  1973 lines
     discovery-method-registry.mjs  828 lines
  GREP over the id list (fixed strings, whole file):
     0 hits
  GREP over the component-basename list:
     0 hits
  --- non-zero control: the SAME predicate, pointed at a file that DOES name them ---
  9
  105
  ```
  The zero is a real zero: the same predicate finds 9 id lines and 105 component-basename lines in the sealed file it was derived from.

- [x] Mutation control: drop the cross-sealed-set component collision and show cases (a) and (i) go red. Paste, then revert.
  ```
  MUTATION APPLIED: shared_components arm disabled
  === AC(a) under the mutation ===
  ✖ AC(a): a case sharing >= REQUIRED components with a case in a DIFFERENT sealed file ⇒ HELD_OUT_PREVIOUSLY_USED
  ✖ AC(c): a case matching an EARLIER version's seed of a DIFFERENT method's lineage ⇒ refused
  ✖ AC(d): a sealed set with ONE colliding case ⇒ SEALED_SET_CONTAMINATED naming it (zero model calls)
  ℹ tests 47 / ℹ pass 44 / ℹ fail 3

  === counterexamples (i)-(iii) under the mutation ===
  --- i-…   refusal_code: null   ok: true   model_calls: 0
  --- ii-…  refusal_code: null   ok: true   model_calls: 0
  --- iii-… refusal_code: null   ok: true   model_calls: 0
  FAIL  (i)   new case id, same files        ⇒ REFUSED  (ok=true, expected false)
  FAIL  (ii)  same basenames, dir renamed    ⇒ REFUSED  (ok=true, expected false)
  PASS  (iii) one file swapped, unrelated    ⇒ ACCEPTED (ok=true, expected true)
  ```
  Reverted (`md5` identical to the pre-mutation copy; 0 mutation tokens left), after which the two files are back to 81/81 and (i)–(iii) PASS again. (iii) stays PASS under the mutation — that is the point of the control: the arm being removed is the component arm, not the whole predicate.

## Definition of Done
- All AC ticked with output pasted. ✅ (6/6 above)
- `scripts/test.sh --for-task gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion` green. ✅ exit 0 (scoped static checks + the two suites; `ℹ tests 81 / ℹ pass 81 / ℹ fail 0`); `tsc --noEmit -p tsconfig.json` exit 0; scoped-gate cache written for develop `963206d62b4af3f057b390e5105945de46bafde3`.
- No model call was made by this task. ✅ The replay, the counterexamples and the backfill import only pure functions and construct NO model seam; every new test case injects a `stubModel` and asserts `calls === 0` on the refusal arms.

## Touches
- tasks/gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion.md
- docs/analysis/discovery-reflection.mjs
- docs/analysis/discovery-method-registry.mjs
- plugin/test/discovery-reflection.test.mjs
- plugin/test/discovery-method-registry.test.mjs
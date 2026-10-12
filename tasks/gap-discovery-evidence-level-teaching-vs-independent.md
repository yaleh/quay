---
id: gap-discovery-evidence-level-teaching-vs-independent
title: "Evidence levels (teaching/transfer/independent/production-open): only
  independent verdicts promote; quarantined lineages cannot be revived by lower
  levels"
status: done
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
- [x] `node --test plugin/test/discovery-reflection.test.mjs plugin/test/discovery-method-registry.test.mjs plugin/test/discovery-experience-ledger.test.mjs` exits 0, with new cases:
  - (a) a teaching-level correct verdict cannot reach `active` (at most `trial`);
  - (b) an `unlabelled` legacy verdict is never `independent`;
  - (c) `shared-contract-divergence` re-promotion with a transfer verdict ⇒ `QUARANTINED_LINEAGE_NEEDS_INDEPENDENT`;
  - (d) a transfer verdict reusing a known case is accepted at transfer level and names its source;
  - (e) `activeMethods()` never returns `trial` methods.

  ```
  ℹ tests 142
  ℹ suites 0
  ℹ pass 142
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ```
  The five named cases (the first four are new; each names the level it is about):
  ```
  ✔ AC(a): a teaching-level CORRECT verdict cannot reach `active` — at most `trial`
  ✔ AC(b): an UNLABELLED legacy verdict is never `independent` — and never licenses `active`
  ✔ AC(c): `shared-contract-divergence` re-promotion on a QUARANTINEd lineage with a TRANSFER verdict ⇒ QUARANTINED_LINEAGE_NEEDS_INDEPENDENT
  ✔ AC(d): a TRANSFER verdict reusing a known case is ACCEPTED at transfer level, and NAMES its source
  ✔ AC(e): `activeMethods()` never returns a `trial` method — it is REPORTED separately instead
  ```
  Controls on the same predicates, so the refusals above are the LEVEL and not a record that could never
  pass: `AC(c-control)` (a QUARANTINEd lineage IS revivable on an `independent` verdict whose case shares
  nothing — and refused with `QUARANTINED_LINEAGE_CASE_REUSED` when it does), `AC(d-2)` (an undeclared
  level is RECORDED as `unlabelled` and caps the candidate at `trial`), `AC(d-3)`
  (`independentLearningQuality` excludes teaching/transfer AND reports how many it excluded),
  `AC(level)` ×2 in the ledger suite. One pre-existing pin was WIDENED, not relaxed:
  `METHOD_STATUSES` now pins `["draft","trial","active","retired"]` and `PROMOTION_REFUSAL_CAUSES` pins the
  ten causes, so a *silently removed* status or cause still reds the test.

- [x] Real check: a no-model replay of a transfer-level verdict for `shared-contract-divergence` is refused for active. Paste the refusal and `activeMethods()` = `[]`.

  Real carriers, LIVE shared checkout, read only; the replay constructs the transfer verdict as an object
  and imports only the registry + the verdict reader — **no model seam is constructed anywhere in the run**:
  ```
  registry: ok=true history=24 latest=5 malformed=0
  verdicts: ok=true records=21
  latest shared-contract-divergence: v7 status=retired reason[:40]="QUARANTINE 2026-10-12 (operator, user-au"
  quarantined_lineage=true versions=[7] cases_behind=["experience-3af7e6e006435de2"]

  === REFUSED RE-PROMOTION: shared-contract-divergence v8 status=active citing a TRANSFER verdict ===
  ok: false
  PROMOTION_WITHOUT_VALID_GENERALIZATION:QUARANTINED_LINEAGE_NEEDS_INDEPENDENT:shared-contract-divergence-has-a-QUARANTINEd-lineage-(v7)-and-generalization_verdict-replay-transfer-1-carries-evidence_level=transfer-so-it-can-neither-be-active-nor-trial
  same transfer verdict at status=trial ⇒ refused: true
  same shape, evidence_level=independent ⇒ the LEVEL refusal is gone: true
      (other reasons remain: ["...:VERDICT_NOT_RECORDED:generalization_verdict-replay-transfer-1-names-no-recorded-verdict"])

  === activeMethods() ON THE LIVE CARRIER ===
  {"ok":true,"methods":[],"trials":[],"evaluated":5,"malformed_lines":0,"file":"/data/home/yale/work/quay/.quay/discovery-method-registry.jsonl","excluded_contaminated":[],"contaminated_verdicts_evaluated":17}
  ```
  `activeMethods()` is `{methods:[], trials:[]}` — **no method is active**, the two contaminated
  promotions are still retired, and the transfer-level re-promotion is refused while the SAME record at
  an `independent` level is refused only for `VERDICT_NOT_RECORDED` (the constructed verdict is not on the
  live carrier) — i.e. the level arm is what refused it. This task promotes nothing.

- [x] Mutation control: allow `transfer` to promote to `active`, and show cases (a) and (c) go red. Paste, then revert.

  Mutation: the evidence-level gate is removed in BOTH arms (`if (level !== INDEPENDENT_EVIDENCE_LEVEL)`
  in the quarantine arm and the generic arm ⇒ `if (false)`), so any level licenses `active`.
  ```
  MUTATION APPLIED: `transfer` (any non-independent level) now promotes to `active`
  === AC(a) and AC(c) under the mutation ===
  ✖ AC(a): a teaching-level CORRECT verdict cannot reach `active` — at most `trial`
  ✖ AC(b): an UNLABELLED legacy verdict is never `independent` — and never licenses `active`
  ✖ AC(c): `shared-contract-divergence` re-promotion on a QUARANTINEd lineage with a TRANSFER verdict ⇒ QUARANTINED_LINEAGE_NEEDS_INDEPENDENT
  ✔ AC(c-control): a QUARANTINEd lineage IS revivable on an `independent` verdict whose case shares nothing
  ✔ AC(e): `activeMethods()` never returns a `trial` method — it is REPORTED separately instead
  ℹ tests 39 / ℹ pass 36 / ℹ fail 3

  --- the assertions that reddened ---
  AssertionError: a teaching verdict must NOT license `active`      actual: true  expected: false
  AssertionError: a legacy verdict must not license `active`        actual: true  expected: false
  AssertionError: got ...:QUARANTINE_CASE_SET_UNAVAILABLE:...  actual: 'QUARANTINE_CASE_SET_UNAVAILABLE'
                                                               expected: 'QUARANTINED_LINEAGE_NEEDS_INDEPENDENT'
  ```
  (b) reddens too — it is the same gate — and `AC(e)`/`AC(c-control)` stay GREEN, so the mutation is
  specific to the level arm rather than to the whole predicate. Reverted from a `cp` backup (not `git
  checkout`):
  ```
  md5 after revert: 8f21f567f0948dcc85e11d2abe6ac073  docs/analysis/discovery-method-registry.mjs
                    8f21f567f0948dcc85e11d2abe6ac073  /tmp/reg-final-before-mutation.mjs
  mutation tokens left: 0
  === suites after revert ===  ℹ tests 142 / pass 142 / fail 0
  ```

## Definition of Done
- All AC ticked with output pasted. ✅ (3/3 above)
- `scripts/test.sh --for-task gap-discovery-evidence-level-teaching-vs-independent` green. ✅ exit 0 —
  scoped static checks + the three suites (`ℹ tests 142 / ℹ pass 142 / ℹ fail 0`); `npx tsc --noEmit -p
  tsconfig.json` exit 0.

## Touches
- tasks/gap-discovery-evidence-level-teaching-vs-independent.md
- docs/analysis/discovery-reflection.mjs
- docs/analysis/discovery-method-registry.mjs
- docs/analysis/discovery-experience-ledger.mjs
- plugin/test/discovery-reflection.test.mjs
- plugin/test/discovery-method-registry.test.mjs
- plugin/test/discovery-experience-ledger.test.mjs

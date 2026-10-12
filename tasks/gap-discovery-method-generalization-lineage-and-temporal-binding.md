---
id: gap-discovery-method-generalization-lineage-and-temporal-binding
title: "Discovery Method: held-out generalization must exclude the whole method
  lineage and bind expected labels to an evaluation pin"
status: done
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
- [x] `node --test plugin/test/discovery-reflection.test.mjs` exits 0, with new cases:
  - (a) held-out whose `source_ref` is in an EARLIER version's provenance ⇒ `HELD_OUT_SHARES_LINEAGE`;
  - (b) held-out sharing ≥2 components with a lineage seed but a different record ⇒ refused;
  - (c) held-out from an unrelated lineage ⇒ accepted;
  - (d) missing `evaluation_pin` ⇒ `NO_EVALUATION_PIN`;
  - (e) `fix_commit` ancestor of `evaluation_pin` ⇒ `TEMPORAL_MISMATCH`;
  - (f) the verifier cwd is a stripped tree at the pin (assert absent `tasks/`, `.quay/`) and the verdict records the evaluated commit.
- [x] Real replay of the invalid promotion: reconstruct `shared-contract-divergence` v1 (provenance `outcome-bb12a6858838e74b`) and v2 (provenance = the fan-in lock Experience) from the evidence pasted in the Phase 2 task, and call `validateGeneralization` with the REQUIRED_FIELDS Experience as held-out. Paste the refusal (`HELD_OUT_SHARES_LINEAGE`, zero model calls). Then re-run with `evaluation_pin` = develop and `fix_commit` = `706545794` against a non-lineage method and paste `TEMPORAL_MISMATCH`.
- [x] Mutation control: reduce the lineage check back to "this version's provenance only" and show case (a) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-method-generalization-lineage-and-temporal-binding` green.

## Touches
- tasks/gap-discovery-method-generalization-lineage-and-temporal-binding.md
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-reflection.test.mjs

## Evidence

All commands ran in the task worktree
`/home/yale/work/quay-worktrees/gap-discovery-method-generalization-lineage-and-temporal-binding`
(worktree HEAD `6dfc04bc4`, merged with develop `2a040c197` — "Already up to date").
**No model call is made anywhere in this task's verification**: the whole deliverable is a set of
REFUSALS that happen *before* the call, and every reading below asserts `model_calls = 0`.

### AC1 — `node --test plugin/test/discovery-reflection.test.mjs` exits 0

```
$ node --test plugin/test/discovery-reflection.test.mjs
✔ AC1(a): two experiences with the same subjectKey signature collapse into ONE unit, count reported
✔ AC1(a): a signature already reflected-on in a PRIOR attempt is dropped, and reported
✔ AC1(a): `maxPerRun` caps the batch and the cap is REPORTED
✔ AC1(b): enabled:false ⇒ reflect returns {ok:false,reason:'disabled'} and makes ZERO model calls
✔ AC1(b): a malformed budget is REFUSED (its own reason), never silently coerced
✔ AC1(c): exceeding maxModelCalls mid-batch STOPS further calls and reports the skipped count
✔ AC1(d): a WRONG generalization prediction retires the candidate with a non-null reason (never promotes)
✔ AC1(d): a held-out case INSIDE the candidate's own batch is refused (transfer is not self-grading)
✔ AC1(a): a held-out case whose source_ref sits in an EARLIER version's provenance ⇒ HELD_OUT_SHARES_LINEAGE (zero model calls)
✔ AC1(b): a held-out case sharing >= 2 components with a lineage SEED (a different record) is refused
✔ AC1(c): a held-out case from an UNRELATED lineage is ACCEPTED and still promotes on a correct prediction
✔ AC1(d): a held-out case with no `evaluation_pin` ⇒ NO_EVALUATION_PIN (its own refusal, zero calls)
✔ AC1(e): `fix_commit` being an ancestor of `evaluation_pin` ⇒ TEMPORAL_MISMATCH; the reverse order passes
✔ AC1(f): the verifier cwd is a stripped tree at the pin and the verdict records the evaluated commit
✔ lineageVersions walks every version of the method_id plus every `method:<id>@<v>` ref in provenance
✔ AC1(e): decision extends with an UNRESOLVED method_ref is REFUSED; a resolvable one is accepted
✔ AC1(e)/(3): a `no-method` verdict is a REAL judgment (ok, no candidate), distinct from a refusal
✔ prompt isolation: a unit's reflection prompt never carries a DIFFERENT unit's material
✔ the reflection-attempt carrier round-trips and then suppresses the next round's re-ask
✔ runReflectionRound reads the carriers, selects, reflects, and records one attempt per unit
✔ metrics: reflection_cost sums present usage only; learning_quality is null when nothing was evaluated
✔ registryDigest exposes exactly what the model needs (method_id/status/signals/operation/invariant)
✔ static control: the production source contains ZERO occurrences of any seed symbol (no hand-coding)
ℹ tests 23   ℹ pass 23   ℹ fail 0   ℹ skipped 0
```

Each of the six new cases asserts what the AC names, and each has a **positive control on the same
predicate inside the same test** so a zero is a real zero rather than a dead branch:

| case | asserted | positive control in the same test |
|---|---|---|
| (a) | `refusal_code === "HELD_OUT_SHARES_LINEAGE"`, `counter.calls === 0`, `candidate_after.status === "draft"` | drop v1 from the registry and the SAME held-out is refused `NO_EVALUATION_PIN` instead — the code above is the lineage, not a blanket no |
| (b) | `refusal_code === "HELD_OUT_SHARES_LINEAGE"`, `lineage_hits == [{kind:"shared_components", …}]` | ONE shared component (`LINEAGE_MIN_SHARED_COMPONENTS === 2`) is NOT refused — the ≥2 is a discriminator, not a tautology |
| (c) | `outcome === "evaluated"`, `promoted === true`, `candidate_after.status === "active"` | — (this IS the accept arm) |
| (d) | `refusal_code === "NO_EVALUATION_PIN"`, `counter.calls === 0` | `confirmed-negative` (non-positive) binds no fix ⇒ `{ok:true}`; a positive case missing only its fix ⇒ `NO_FIX_COMMIT` (enumerated, 硬规则 3) |
| (e) | `refusal_code === "TEMPORAL_MISMATCH"` | the SAME two commits in the other order (pin before fix) evaluate and promote |
| (f) | `verifier_cwd === pin`, `evaluated_commit === pin`, `!exists(pin/tasks)`, `!exists(pin/.quay)` | an unstripped dir ⇒ `PIN_NOT_STRIPPED:tasks`; the live checkout ⇒ `PIN_IS_LIVE_CHECKOUT`; an unresolvable rev ⇒ `PIN_MATERIALIZE_FAILED:` |

(f) materialises a **real** tree with `git archive` from a **real** git repo built in the test, whose
pin commit genuinely carries `tasks/` and `.quay/`; the test asserts those two are what
`materializeStrippedPin` reports as `removed`, that the code file is still there, and that the live
checkout carries **every** one of the eleven forbidden directories:

```
assert.deepEqual(DISCOVERY_PIN_FORBIDDEN_DIRS.filter((d) => fs.existsSync(path.join(REPO_ROOT, d))).sort(),
  [".quay","adr","archive","docs","experiments","goals","measurements","meta","milestones","orchestration","tasks"])
```

The three-valued ancestry seam is pinned too (硬规则 3b): `isAncestor(fix, later) === true`,
`isAncestor(later, fix) === false`, and an **unresolvable** commit returns `null` — never `false` —
so a git failure cannot read as "the pin is fine".

### AC2 — real replay of the invalid promotion (zero model calls)

The Experiences are NOT hand-narrated: the **real** evidence store
(`/data/home/yale/work/quay/.quay/architecture-evidence-store.jsonl`, 199797 bytes) was copied in
byte-identically and all three were derived through the ledger's OWN automatic adapter
`ingestFromEvidenceStoreOutcome`. The three matched carrier lines are **234 / 185 / 137** — exactly the
lines the Phase 2 task cites for these same three cases, so this is the same material, not a fixture:

```
  EXP-fan-in-lock-hold-pairing              id=experience-d7fe7a62d6225d4c  source_ref=outcome-31fc82ad5d6c1f86  derived_from line 234
  EXP-per-task-suite-record-required-fields id=experience-18c09c98f54f8e42  source_ref=outcome-bb12a6858838e74b  derived_from line 185
  EXP-checker-exit-code-split               id=experience-a2c20507c7a1d2d0  source_ref=outcome-696a9770477e60e0  derived_from line 137
```

`shared-contract-divergence` v1 was reconstructed exactly as the Phase 2 Evidence describes it
("re-created the live registry by re-registering the prior registry task's one real method against the
SAME real evidence record it cited (`outcome-bb12a6858838e74b`)"), and **v2 was produced by the
production path** `assembleCandidate` from a reflection decision on the fan-in unit, so its provenance
is the fan-in Experience's id and its version is 2:

```
REPLAY 1 — candidate shared-contract-divergence v2 (provenance ["experience-d7fe7a62d6225d4c"])
           held out  EXP-per-task-suite-record-required-fields  (source_ref outcome-bb12a6858838e74b)
           v1 lineage provenance: ["outcome-bb12a6858838e74b"]

{
 "refusal_code": "HELD_OUT_SHARES_LINEAGE",
 "outcome": "not-evaluated",
 "reason": "HELD_OUT_SHARES_LINEAGE:experience-18c09c98f54f8e42-version_provenance-outcome-bb12a6858838e74b-via-shared-contract-divergence@1",
 "lineage": ["shared-contract-divergence@2", "shared-contract-divergence@1"],
 "lineage_hits": [{ "kind": "version_provenance", "method": "shared-contract-divergence@1", "ref": "outcome-bb12a6858838e74b" }],
 "promoted": false,
 "candidate_status_after": "draft",
 "model_calls": 0
}
```

**The audited promotion is now refused, and it is refused for the right reason**: v2's OWN provenance
(`experience-d7fe7a62d6225d4c`) does not carry the held-out case — the pre-existing in-batch check
passes — and the hit is one version back, on **`shared-contract-divergence@1`**.

The temporal half, against a method that shares no lineage with the held-out case at all
(`producer-consumer-exit-code-vocabulary-gap` v1, seeded from the checker Experience):

```
REPLAY 2 — candidate producer-consumer-exit-code-vocabulary-gap v1 (provenance ["experience-a2c20507c7a1d2d0"]), held out EXP-per-task-suite-record-required-fields
           evaluation_pin = 9a329772a5c261616fe4b0433abb4853dbe4d6be (the commit the invalid verifier read)   fix_commit = 706545794
  the audited reading 9a329772a: pin=9a329772a5c261616fe4b0433abb4853dbe4d6be
  {"refusal_code":"TEMPORAL_MISMATCH","outcome":"not-evaluated","reason":"TEMPORAL_MISMATCH:fix_commit-70654579464555f7ddda05fc711b7a55307f8cf5-is-an-ancestor-of-evaluation_pin-9a329772a5c261616fe4b0433abb4853dbe4d6be-so-the-fix-had-already-landed-and-the-pin-cannot-exhibit-the-defect","promoted":false,"model_calls":0}
  current develop: pin=2a040c197f008c63aabcba1c6e942d543049de9d
  {"refusal_code":"TEMPORAL_MISMATCH","outcome":"not-evaluated","reason":"TEMPORAL_MISMATCH:fix_commit-70654579464555f7ddda05fc711b7a55307f8cf5-is-an-ancestor-of-evaluation_pin-2a040c197f008c63aabcba1c6e942d543049de9d-so-the-fix-had-already-landed-and-the-pin-cannot-exhibit-the-defect","promoted":false,"model_calls":0}

fix_commit 706545794 resolves to 70654579464555f7ddda05fc711b7a55307f8cf5 (distinct from both pins above)
```

Both arms are green through the production entry point; both spend **zero** model calls and leave the
candidate at `draft`.

**Honesty note on the Experience ids.** The carrier is a gitignored runtime artifact the Phase 2 task
did not preserve, so the three `id=` values above are RE-DERIVED deterministically by the ledger's own
`recordId` from the matched carrier line + the `caseId`/`components` taken verbatim from the Phase 2
task (the `summary` text is this task's, since the Phase 2 task pasted none, and it participates in the
content address). What the refusal keys on — `source_ref` `outcome-bb12a6858838e74b` and v1's
`provenance_evidence` — are the exact strings pasted in the Phase 2 task, and the matched carrier lines
(234/185/137) are the ones that task cites. **The reconstruction is faithful on the axis the defect
lives on.**

### AC3 — mutation control (reduce the lineage check to "this version's provenance only")

Mutation applied to `lineageVersions` (the registry view feeds an empty list, so only the candidate
itself is scanned — i.e. precisely the pre-fix behaviour):

```diff
 export function lineageVersions(candidate, registry = []) {
-  const all = (Array.isArray(registry) ? registry : (registry?.history ?? registry?.latest ?? [])).filter(isObj);
+  const all = [];   // MUTATION CONTROL: lineage reduced to "this version's provenance only"
```

```
$ node --test plugin/test/discovery-reflection.test.mjs
✖ AC1(a): a held-out case whose source_ref sits in an EARLIER version's provenance ⇒ HELD_OUT_SHARES_LINEAGE (zero model calls)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'NO_EVALUATION_PIN'
  - 'HELD_OUT_SHARES_LINEAGE'
      at TestContext.<anonymous> (…/plugin/test/discovery-reflection.test.mjs:278:10)
✖ lineageVersions walks every version of the method_id plus every `method:<id>@<v>` ref in provenance
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    [ 'm-a@4', - 'm-a@1', - 'm-a@3', - 'm-b@2' ]
ℹ tests 23   ℹ pass 21   ℹ fail 2
```

Case (a) goes red **in the informative direction**: with the lineage walk removed, the very same
held-out case sails past the check and is refused only for its missing pin (`NO_EVALUATION_PIN`) — the
hole the audit found is re-opened, and the test notices.

Reverted by restoring the byte-identical backup (not `git checkout`):

```
$ cp .quay/mutation-control-backup.mjs docs/analysis/discovery-reflection.mjs
$ md5sum docs/analysis/discovery-reflection.mjs   # before the mutation AND after the revert:
77303c76d442461f9e2c02a87e33ef19  docs/analysis/discovery-reflection.mjs
$ grep -c "MUTATION CONTROL" docs/analysis/discovery-reflection.mjs   → 0
$ node --test plugin/test/discovery-reflection.test.mjs   → ℹ tests 23   ℹ pass 23   ℹ fail 0
```

### DoD — `scripts/test.sh --for-task gap-discovery-method-generalization-lineage-and-temporal-binding --allow-thin`

```
EXIT=0
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
PASS — reattribution ratchet: 0 pure-S un-attributed test(s) (layer 1, blocking); 0 zombie entr(y|ies)
PASS: every test file uses node:test or is a listed legacy exemption; … new files declare @test-group.
PASS: no checked-in-tree writes: 79 write-verb call(s) across 1 executed input(s), 0 inside the tree
PASS: no new task-file bypass — 38 hit(s), all within the allowlist
PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0 (headBaseline {"valueSccs":0,"typeSccs":0,"reverseEdges":0})
PASS — embeddedInterpreterLines=6566 ≤ 6566, duplicateCopies=0 ≤ 0
PASS: all 21 violation(s) are baselined in plugin/test-isolation-violations.txt
ℹ tests 23   ℹ pass 23   ℹ fail 0   ℹ skipped 0
```

Scoped-gate cache recorded for fan-in:
`{"event":"scoped-gate-cache-written","task":"gap-discovery-method-generalization-lineage-and-temporal-binding","developSha":"2a040c197f008c63aabcba1c6e942d543049de9d"}`

### Scope / honesty notes

- **No model call is made by this task's verification.** The deliverable is three refusals; the
  model-calling path is untouched. The change therefore does NOT claim that the discovery method now
  learns better in production — it claims the held-out test can no longer be satisfied by a case the
  method was already fitted to, nor read at a commit where the case's defect is fixed.
- **Touches is exhaustive**: only `docs/analysis/discovery-reflection.mjs` (implementation) and
  `plugin/test/discovery-reflection.test.mjs` (tests) are changed. No routine wiring, no driver kind,
  no registry/ledger/store change.
- **`validateGeneralization` is now fail-closed without a `pinDir`** (`PIN_DIR_REQUIRED`) and refuses
  the live checkout (`PIN_IS_LIVE_CHECKOUT`). Existing callers must materialise the pin with
  `materializeStrippedPin` and launch their injected `model` seam with that directory as cwd; the
  function verifies the directory is stripped and records it as `verifier_cwd` alongside
  `evaluated_commit`.
- **Observed limit handed forward**: the verifier's cwd is enforced by construction + verification, not
  by the function spawning the process itself (the model seam is injected). A future routine-wiring task
  that launches `liveModelFactory({root: pinDir, tools: "Read,Grep"})` is the point at which the cwd
  becomes mechanically forced rather than checked.
- All three refusal codes are recorded in ONE shape (`outcome:"not-evaluated"`, `refusal_code`,
  `promoted:false`, `correct:null`, `candidate_after` returned untouched), so a refused READING can
  never be read back as a failed METHOD (硬规则 3b). The pre-existing `not_evaluated_reason` readings
  (`UNPARSEABLE_MODEL_OUTPUT` / `VERDICT_MISSING_IN_MODEL_OUTPUT`) now also carry
  `outcome:"not-evaluated"`, and the evaluated arms carry `outcome:"evaluated"`.

---
id: gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples
title: Evidence store has no verdict, counterexample, or runtime-carrier
  provenance slot for architecture-discovery findings
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
I ran a bounded shadow experiment on 2026-10-11 against real data. It is read-only, and its tools live in `/data/home/yale/work/quay-scratch/arch-discovery-shadow/`. It wrote every record through the production `validateRecord` in `docs/analysis/architecture-evidence-store.mjs`. Measured readings from `out/{expA,expA3,expB}.jsonl`:
- **Verdict vocabulary.** expA wrote 148 records and 17 were refused. All 17 refusals are `VERDICT_NOT_IN_VOCAB`: `drift-hypothesis` 4, `legit-difference` 5, `undetermined` 8. `OUTCOME_VERDICTS` only knows the ownership-loop verdicts `proposed|abstained|investigated|not-evaluated|exempted`, so the store cannot record a consistency finding's result at all.
- **Counterexamples look like hypotheses.** 46 counterexample records (expA 12, expB 34) could only be written as `kind: hypothesis` with an extension field `counterexample_of`. The validator ACCEPTED all 46 without ever checking that field. A counterexample is therefore indistinguishable from a hypothesis on every validated field. This is hard rule 3b: an input the validator does not understand gets a result shaped exactly like a valid one.
- **No slot for runtime-carrier provenance.** `ref` is defined as "the commit sha the reading was taken AT". All 7 expB evidence records come from runtime carriers (`.quay/worker-outcome.jsonl`, `.quay/gate-events.jsonl`, `.quay/anchor.log`, journalctl), so `ref` could only hold the develop sha. That says nothing about which carrier line the reading came from. The carrier path, 1-based line number, and sha256 of the line had to ride in unvalidated extension fields.
- **Subject key.** `subjectKey(concernKind, files)` already exists and was reused unchanged. It is not a gap.

<!-- dedup-ref --> Builds on `gap-architecture-evidence-store-and-decision-memory` (done), which created the store. Related but different: `docs/analysis/defect-discovery-latency-distribution.md` measures discovery latency and records no findings.

## Plan
1. Add verdicts to `OUTCOME_VERDICTS` for discovery findings: `supported`, `refuted`, `undetermined`. Keep the existing five unchanged. Do not add domain-specific verdicts such as drift or legit; those belong in the hypothesis statement.
2. Add a record kind `counterexample` with these required fields: `counterexample_of` (the hypothesis statement or id it refutes), `source_evidence` (at least 1 ref), and `ts`. The validator must refuse a counterexample that is missing `counterexample_of`, with a distinct reason code.
3. Accept a third evidence location form, `carrier: {path, line, line_sha256}` (64-hex). It sits alongside path+range and scope+flags. When an evidence record uses this form, `ref` may be the carrier path, because no commit sha applies.
4. Leave every existing record kind's accept/refuse behaviour unchanged. The 49 production records in `.quay/architecture-evidence-store.jsonl` must still validate.

## Acceptance Criteria
- [x] `node --test plugin/test/architecture-evidence-store.test.mjs` exits 0, with new cases covering: (a) an outcome with verdict `refuted` is accepted; (b) an outcome with verdict `legit-difference` is still refused with `VERDICT_NOT_IN_VOCAB`; (c) a `counterexample` record missing `counterexample_of` is refused with a reason code distinct from `SCHEMA_MISSING:source_evidence`; (d) evidence with `carrier:{path,line,line_sha256}` and no path/range/scope is accepted, and the same record with a non-hex `line_sha256` is refused.
  - Evidence (worktree `gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples`): `tests 17 / pass 17 / fail 0`, `TEST_EXIT=0`. New cases all green:
    - `AC-a`: `appendOutcomeRecord({...GOOD.outcome, verdict:"refuted"})` → ok, reads back with `verdict: "refuted"`, id `^outcome-`; `supported` and `undetermined` also accepted.
    - `AC-b`: verdict `legit-difference` → `reasons === ["VERDICT_NOT_IN_VOCAB:legit-difference"]`, 0 lines written; `drift-hypothesis` likewise refused.
    - `AC-c`: counterexample with `counterexample_of` deleted → `reasons === ["SCHEMA_MISSING:counterexample_of"]`, and `assert.notEqual(r.reasons[0], "SCHEMA_MISSING:source_evidence")`. Unclear/differently-broken variants keep their own codes (`COUNTEREXAMPLE_UNGROUNDED:…`, `COUNTEREXAMPLE_UNREFUTED:…`).
    - `AC-d`: evidence with only `carrier:{path,line,line_sha256:"dddd…"}` and `ref` = carrier path → accepted; same with `line_sha256:"not-hex"` → refused with `FIELD_INVALID:carrier…`; the untouched `path+range` and `scope+flags` forms still accepted.
  - The pre-existing `OUTCOME_VERDICTS` pin was updated to assert the **unchanged** five-verdict prefix plus the appended discovery verdicts — the five are not re-ordered or renamed: `assert.deepEqual([...OUTCOME_VERDICTS].slice(0,5), ["proposed","abstained","investigated","not-evaluated","exempted"])`.
- [x] Back-compat on the production carrier: every line of `/data/home/yale/work/quay/.quay/architecture-evidence-store.jsonl`, re-validated with the new validator, gives the same ok/refused result as with the develop-tip validator. Paste the count, which must be 0 differences, and the total number of lines compared.
  - Evidence — both validators loaded side by side (develop-tip from `git show develop:docs/analysis/architecture-evidence-store.mjs`, new from the worktree), every line re-validated with each:
    ```json
    {"develop_tip":"70fb25a037ba316d643cf84c5874eafd5c78c521","total_lines_compared":49,
     "differences":0,"detail":[],
     "negative_control":{"probe_verdict_refuted_old_ok":false,"new_ok":true,"validators_are_distinguishable":true}}
    ```
    **49 lines compared, 0 differences.** The negative control matters: a probe the two validators MUST disagree on (an `outcome` with verdict `refuted`) does disagree (`false` → `true`), so the `0` is a measurement of agreement, not a comparison that could not have failed.
- [x] Re-run `node /data/home/yale/work/quay-scratch/arch-discovery-shadow/expB.mjs` and `expA.mjs` with `lib.mjs` pointed at the worktree's store module (set the import in `lib.mjs` from an env var, or copy the scratch dir). Write the counterexamples as kind `counterexample` and the expA verdicts mapped as drift-hypothesis→`supported`, legit-difference→`refuted`, undetermined→`undetermined`. Paste the validator tally: refused must be 0, and the counterexample count must be ≥40.
  - Method: the scratch dir was **copied** (`/tmp/ac3-shadow-owmFtd/arch-discovery-shadow`, `out/` emptied) and its `lib.mjs` made env-driven — `ARCH_STORE_MODULE` selects the store module, `ARCH_OUT` the output dir — so the original evidence directory was never overwritten. `lineEvidence` now emits the new `carrier:{path,line,line_sha256}` form; `expA.mjs` maps the pre-registered rule label to the store verdict at the `sink.add("outcome", …)` boundary (the rule label is kept as `rule_verdict` for scoring); every `counterexample_of`-bearing record in `expA.mjs`/`expB.mjs` is written as `kind:"counterexample"`.
  - Evidence — validator tally from `out/expA-report.json` / `out/expB-report.json`:
    ```
    expA: {"accepted": 148, "refused": 0, "reasons": {}}
    expB: {"accepted":  48, "refused": 0, "reasons": {}}
    ```
    **Total refused = 0.** Kind tally over `out/expA.jsonl` + `out/expB.jsonl` (196 records):
    ```
    {'evidence': 75, 'hypothesis': 41, 'counterexample': 46, 'experiment': 17, 'outcome': 17}
    counterexample records: 46   (≥40 ✓)
    counterexamples missing a required field: 0
    ```
    expA store verdicts (17 outcomes, = the 17 formerly-refused): `supported` 4, `refuted` 5, `undetermined` 8 — exactly the pre-registered rule labels `drift-hypothesis` 4 / `legit-difference` 5 / `undetermined` 8. Evidence location forms exercised: `file+range` 51, `scope+flags` 7, `carrier` 17 (the third form is real, not vestigial).
- [x] Mutation control: temporarily remove the `counterexample_of` requirement. Case (c) must go red. Paste the output, then restore the requirement.
  - Mutation applied: `counterexample: Object.freeze(["counterexample_of","source_evidence","ts"])` → `counterexample: Object.freeze(["source_evidence","ts"])`. Output of `node --test --test-name-pattern AC-c plugin/test/architecture-evidence-store.test.mjs`:
    ```
    ✖ AC-c: a counterexample missing `counterexample_of` is refused with a reason
      distinct from SCHEMA_MISSING:source_evidence (3.46ms)
    ℹ tests 1  ℹ pass 0  ℹ fail 1
      AssertionError [ERR_ASSERTION]: a counterexample that names no hypothesis is refused
      true !== false
          at TestContext.<anonymous> (…architecture-evidence-store.test.mjs:171:10)
    ```
    **Case (c) went red** — with the requirement gone the nameless counterexample was ACCEPTED (`actual: true`), which is precisely what the test forbids. Requirement **restored**; full file re-run → `tests 17 / pass 17 / fail 0` (and `git diff` shows no residue of the mutation).

## Definition of Done
- All AC ticked with command output pasted.
- `scripts/test.sh --for-task gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples` green.

## Touches
- tasks/gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples.md
- docs/analysis/architecture-evidence-store.mjs
- plugin/test/architecture-evidence-store.test.mjs

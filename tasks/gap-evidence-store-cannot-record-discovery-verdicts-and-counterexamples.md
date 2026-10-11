---
id: gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples
title: Evidence store has no verdict, counterexample, or runtime-carrier
  provenance slot for architecture-discovery findings
status: todo
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
- [ ] `node --test plugin/test/architecture-evidence-store.test.mjs` exits 0, with new cases covering: (a) an outcome with verdict `refuted` is accepted; (b) an outcome with verdict `legit-difference` is still refused with `VERDICT_NOT_IN_VOCAB`; (c) a `counterexample` record missing `counterexample_of` is refused with a reason code distinct from `SCHEMA_MISSING:source_evidence`; (d) evidence with `carrier:{path,line,line_sha256}` and no path/range/scope is accepted, and the same record with a non-hex `line_sha256` is refused.
- [ ] Back-compat on the production carrier: every line of `/data/home/yale/work/quay/.quay/architecture-evidence-store.jsonl`, re-validated with the new validator, gives the same ok/refused result as with the develop-tip validator. Paste the count, which must be 0 differences, and the total number of lines compared.
- [ ] Re-run `node /data/home/yale/work/quay-scratch/arch-discovery-shadow/expB.mjs` and `expA.mjs` with `lib.mjs` pointed at the worktree's store module (set the import in `lib.mjs` from an env var, or copy the scratch dir). Write the counterexamples as kind `counterexample` and the expA verdicts mapped as drift-hypothesis→`supported`, legit-difference→`refuted`, undetermined→`undetermined`. Paste the validator tally: refused must be 0, and the counterexample count must be ≥40.
- [ ] Mutation control: temporarily remove the `counterexample_of` requirement. Case (c) must go red. Paste the output, then restore the requirement.

## Definition of Done
- All AC ticked with command output pasted.
- `scripts/test.sh --for-task gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples` green.

## Touches
- tasks/gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples.md
- docs/analysis/architecture-evidence-store.mjs
- plugin/test/architecture-evidence-store.test.mjs

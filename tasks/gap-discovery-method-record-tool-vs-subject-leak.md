---
id: gap-discovery-method-record-tool-vs-subject-leak
title: "Discovery Method: method records memorize the seed (tool = subject file,
  seed names in method text)"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-method-generalization-lineage-and-temporal-binding
---
## Proposal
The read-only audit found that method DATA memorizes the seed answer although the reflection CODE does not. The Phase 2 candidate `shared-contract-divergence` v2 recorded `operation.tools = ["fan-in-ff-protocol-check.ts","fan-in-queueing-model.ts","dual-source-check.ts","mirror-pair-drift-check.ts"]`: the first two are the seed case's own subject files, not analysis tools.
- Phase 0's validator (`docs/analysis/discovery-method-registry.mjs`) only checks that each tool name is a capability-catalog entry, so it cannot tell "a tool used to inspect" from "the file being inspected".
- Phase 2's no-hand-coding static control scans only `discovery-reflection.mjs` source, not method records.

## Plan
1. In the registry validator, refuse (`TOOL_IS_SUBJECT`) any `operation.tools` entry that equals (by basename) a component of any Experience referenced by the method's `provenance_evidence`.
2. Refuse (`METHOD_TEXT_NAMES_SEED`) a method whose `operation.steps`, `expected_invariant`, `falsification` or `applicability` text names a seed component basename or symbol.
   - The seed set comes from `experienceDenyList` over the provenance Experiences (reuse it; do not re-derive).
3. In `discovery-reflection.mjs`, the reflection prompt states that tools must be analysis instruments. `assembleCandidate` strips subject files from `tools` before validation and records what it stripped, so a refusal is visible, not silent.
4. Records written before this change are unaffected on disk; `readMethodRegistry` flags them `legacy_unvalidated: true` when they would now fail.

## Acceptance Criteria
- [x] `node --test plugin/test/discovery-method-registry.test.mjs plugin/test/discovery-reflection.test.mjs` exits 0, with new cases:
  - (a) a tool equal to a provenance component ⇒ `TOOL_IS_SUBJECT`;
  - (b) a genuine analysis tool not among provenance components ⇒ accepted;
  - (c) `expected_invariant` naming a seed basename ⇒ `METHOD_TEXT_NAMES_SEED`;
  - (d) the same invariant written generically ⇒ accepted;
  - (e) `assembleCandidate` strips a subject file from tools and records it.
- [x] Real control: validate the v2 record exactly as pasted in the Phase 2 task evidence. Paste the refusal naming both `fan-in-ff-protocol-check.ts` and `fan-in-queueing-model.ts`.
- [x] Static check: `grep -n -E 'fan-in-ff-protocol-check|per-task-suite-record|checker-io|touches-parser' docs/analysis/discovery-method-registry.mjs` prints nothing. Paste the output.
- [x] Mutation control: disable the `TOOL_IS_SUBJECT` rule and show case (a) goes red. Paste, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-discovery-method-record-tool-vs-subject-leak` green.

## Touches
- tasks/gap-discovery-method-record-tool-vs-subject-leak.md
- docs/analysis/discovery-method-registry.mjs
- docs/analysis/discovery-reflection.mjs
- plugin/test/discovery-method-registry.test.mjs
- plugin/test/discovery-reflection.test.mjs

## Evidence

All commands ran in the task worktree
`/home/yale/work/quay-worktrees/gap-discovery-method-record-tool-vs-subject-leak`, HEAD
`25af46574` (a plain `git merge --no-edit develop` before the scoped gate: "Already up to date").
**The whole deliverable is a set of REFUSALS computed from the record's own provenance** — no model
call is made anywhere in this task, and no fixture is the source of the seed set: in every case below
the seed components are READ OFF the Experience ledger through the ledger module's own append.

### AC1 — `node --test` on both files exits 0, with the five named cases

```
$ node --test plugin/test/discovery-method-registry.test.mjs plugin/test/discovery-reflection.test.mjs
✔ AC1(a): a tool equal (by basename) to a provenance component ⇒ TOOL_IS_SUBJECT
✔ AC1(b): a genuine analysis tool that is not among the provenance components is ACCEPTED
✔ AC1(c): `expected_invariant` naming a seed basename ⇒ METHOD_TEXT_NAMES_SEED
✔ AC1(d): the same invariant written generically is ACCEPTED — and the scan stays scoped to the provenance
✔ AC1(e): assembleCandidate strips a subject file from `tools` and RECORDS what it stripped
✔ AC1(e): the strip reaches the DECISION row — a model that names the subject files is visible, not silently repaired
… (45 pre-existing cases, all green)
ℹ tests 51   ℹ pass 51   ℹ fail 0
$ echo $?
0
```

Each of the five cases carries a **control on the same predicate inside the same test**, so none of
them can pass by a dead branch:

| case | asserted | control in the same test |
|---|---|---|
| (a) | `TOOL_IS_SUBJECT:subject-writer.ts` | the SAME tool is accepted when the record's provenance cites an evidence-store outcome instead ⇒ the refusal is caused by the provenance, not the name |
| (b) | a real instrument (also catalog-checked) accepted | another case's file is accepted ⇒ the seed set is per record, not a global ban |
| (c) | both seed basenames refused, in deny-list order; the `case_id` refused as the second vocabulary half | `seedScannedTexts(rec).map(field)` deep-equals `SEED_SCANNED_TEXT_FIELDS` ⇒ the scanned set is what the plan names |
| (d) | generic text accepted | the same text IS refused once the record cites that case ⇒ the provenance scoping is not a filter that drops everything |
| (e) | `tools` shrinks to the instrument, `stripped_subject_tools` records the subject | a decision naming only instruments strips `[]`; a unit with no components strips `[]` |

### AC2 — the Phase 2 v2 record, validated

The record is transcribed **verbatim** from the landed Phase 2 task's Evidence section
(`method_id` / `version` / `status` / `operation.tools` / `expected_invariant` / `falsification`); the
seed Experience is transcribed from the same section's re-derived ledger digest, whose signature line
is `found-and-fixed|<the two seed paths>` → `EXP-fan-in-lock-hold-pairing`, `source_ref=outcome-31fc82ad5d6c1f86`,
`verdict=supported`. `operation.steps` / `applicability` / `cost_budget` were NOT pasted and are
reconstructed (generic text, naming no seed). ⛔ Neither carrier survives on disk — `.quay/discovery-*.jsonl`
is a gitignored runtime family — so the paste is the only remaining trace of the real run, and the
provenance is cited by `case_id` (the form the evidence prints) rather than by the content-addressed
ledger `id` (which appeared only inside that carrier).

```
ledger entry: {"ok":true,"id":"experience-f534df15e5fcf465","case_id":"EXP-fan-in-lock-hold-pairing","components":["plugin/scripts/fan-in-ff-protocol-check.ts","plugin/scripts/fan-in-queueing-model.ts"]}
all four tools are REAL catalog entries: true
seed components: ["fan-in-ff-protocol-check.ts","fan-in-queueing-model.ts"]
validateMethodRecord(v2): {
 "ok": false,
 "reasons": [
  "TOOL_IS_SUBJECT:fan-in-ff-protocol-check.ts",
  "TOOL_IS_SUBJECT:fan-in-queueing-model.ts"
 ]
}
names BOTH seed files: true
```

⚠️ The tool catalog used here is the **REAL** one (`defaultToolNames()`, 392 names), not a fixture:
that is the point — all four names are genuine catalog entries, so the OLD contract accepted this
record and only the provenance can refuse it. The two names that ARE instruments
(`dual-source-check.ts`, `mirror-pair-drift-check.ts`) are asserted **not** to be in the seed set.
The same reading is pinned as a re-runnable case:
`✔ AC2 (real control): the Phase 2 v2 record is refused with TOOL_IS_SUBJECT naming BOTH seed files`,
and the append path refuses the same record with the same two codes, writing nothing.

### AC3 — static check on the registry module

```
$ grep -n -E 'fan-in-ff-protocol-check|per-task-suite-record|checker-io|touches-parser' docs/analysis/discovery-method-registry.mjs
$ echo $?
1
```

Nothing printed (exit 1 = no match) — the module's new seed rule contains **no literal seed name**;
the seed set is derived per record. Control on the same predicate (a zero is only a real zero if the
predicate can fire):

```
$ grep -rn -E 'fan-in-ff-protocol-check|per-task-suite-record|checker-io|touches-parser' plugin/test/discovery-method-registry.test.mjs
plugin/test/discovery-method-registry.test.mjs:497:  components: Object.freeze(["plugin/scripts/fan-in-ff-protocol-check.ts", "plugin/scripts/fan-in-queueing-model.ts"]),
plugin/test/discovery-method-registry.test.mjs:514:      "fan-in-ff-protocol-check.ts", "fan-in-queueing-model.ts", "dual-source-check.ts", "mirror-pair-drift-check.ts",
… (3 more)
$ echo $?
0
```

### AC4 — mutation control, then reverted

```
$ md5sum docs/analysis/discovery-method-registry.mjs                       # BEFORE
f808064e4bb127fcd9d9d3654d74d469  docs/analysis/discovery-method-registry.mjs
--- mutation applied: the TOOL_IS_SUBJECT loop disabled (for (const t of [])) ---
$ node --test --test-name-pattern="AC1\(a\): a tool equal" plugin/test/discovery-method-registry.test.mjs
✖ AC1(a): a tool equal (by basename) to a provenance component ⇒ TOOL_IS_SUBJECT
ℹ pass 0   ℹ fail 1
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    actual: true
    expected: false
--- reverted (cp back from the pre-mutation copy) ---
$ md5sum docs/analysis/discovery-method-registry.mjs docs/analysis/../.quay/ac4-before.mjs   # AFTER == BEFORE
f808064e4bb127fcd9d9d3654d74d469  docs/analysis/discovery-method-registry.mjs
f808064e4bb127fcd9d9d3654d74d469  .quay/ac4-before.mjs
$ node --test --test-name-pattern="AC1\(a\): a tool equal" plugin/test/discovery-method-registry.test.mjs
ℹ pass 1   ℹ fail 0
```

Case (a) reads `ok:true` (accepted) with the rule disabled and `ok:false` with it enabled — the
assertion is caused by the rule, not by the surrounding record. The revert is proved by md5 equality
with the pre-mutation copy (the scratch copy was then deleted).

### DoD — `scripts/test.sh --for-task gap-discovery-method-record-tool-vs-subject-leak --allow-thin`

```
$ bash scripts/test.sh --for-task gap-discovery-method-record-tool-vs-subject-leak --allow-thin
== scoped static checks (change-relevant tier; …) ==
  scoped check: run_checker "checked-in-write-check" … --changed --root <worktree>
  scoped check: run_checker "task-contract-check" … --strict-subset <task file>
  scoped check: run_checker "touches-one-entry-one-path-check" … --strict-subset <task file>
  scoped check: run_checker "import-graph-check" … --root <worktree>
  … (17 scoped checks total)
task-contract-check: no violations.
violations: 0 unique across 0 task(s)
✔ (both discovery test files, 51/51)
$ echo $?
0
```

### What this changes, and what it deliberately does not

- **New refusals**: `TOOL_IS_SUBJECT:<tool>`, `METHOD_TEXT_NAMES_SEED:<field>:<value>`,
  `PROVENANCE_SEEDS_UNAVAILABLE:<why>`. The third is the 硬规则 3b arm: an ABSENT or unreadable seed
  set is its own value, never a skipped check — the same discipline the module already applied to the
  tool catalog, for the same reason (a validator blind to the provenance cannot tell a tool from the
  file being inspected).
- **The matcher is reused, not re-derived** (Plan 2): the text scan calls the ledger module's own
  `experienceDenyList` → `scanExperienceLeak`; only the DECISION is scoped, by keeping the matches
  whose `value` is one of this record's own seeds.
- **Pre-existing records are not rewritten** (Plan 4): `readMethodRegistry` leaves the carrier bytes
  alone and flags each latest record `legacy_unvalidated` + `legacy_reasons`, so "re-checked and clean"
  (`false`) is a different value from "never checked under this rule" (`true`) — 硬规则 6.
- **The strip is visible** (Plan 3): `assembleCandidate` records `stripped_subject_tools` on the
  candidate AND on the decision row (both arms), so a model that named its own subject files is
  surfaced rather than silently repaired. The prompt now states the rule as well, but the strip does
  not rely on the model obeying it.
- ⛔ NOT done here (out of scope, and out of ## Touches): no wiring of the reflection stage into any
  routine, no change to the ledger module, no re-validation or rewrite of any already-written carrier.

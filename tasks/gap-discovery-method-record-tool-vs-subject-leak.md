---
id: gap-discovery-method-record-tool-vs-subject-leak
title: "Discovery Method: method records memorize the seed (tool = subject file,
  seed names in method text)"
status: done
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

Every reading below is taken on the FINAL branch state — HEAD `62441b305` (this round's AC2-fixture
repair) on top of the earlier round's 3 commits, in the task worktree
`/data/home/yale/work/quay-worktrees/gap-discovery-method-record-tool-vs-subject-leak`, after a clean
`git merge --no-edit develop` (it brought in only the driver's `## Blocker` section; the merged develop
tip `b8d2dca53` IS `git rev-parse develop`).
**The whole deliverable is a set of REFUSALS computed from the record's own provenance** — no model
call is made anywhere in this task, and no fixture is the source of the seed set: in every case below
the seed components are READ OFF the Experience ledger through the ledger module's own append.

### Why the previous round did not land — ONE static gate, not the tests

The previous round's log (`# tests 0 / # pass 0 / # fail 84` + `# suite red static-check`) shows the
suite aborted in the STATIC phase before a single test ran. The one true cause, verbatim from the log
tail (`.quay/fan-in-suite-gap-discovery-method-record-tool-vs-subject-leak~wk-prod-anchor~1791789239010-3c7bf0.log`):

```
STATIC_CHECK_FAILED: registry-bare-filename-scan exit=1
RED: referenced script(s) still in dead set: dual-source-check.ts
```

Cause, taken by POSITION (not by keyword): the AC2 fixture transcribed the pasted record's
`operation.tools` verbatim, so `plugin/test/discovery-method-registry.test.mjs` carried the bare string
literal `"dual-source-check.ts"`. `registry-bare-filename-scan.ts` collects a bare `plugin/scripts`
basename literal under `plugin/test/**` as a `test-pin` REFERENCE (SPEC §12e, one of the four kinds),
and that script still sits in the committed §12f dead-set snapshot
`docs/analysis/dead-set-recomputed.json`. The gate's criterion is `allReferencedScripts ∩ after.dead = ∅`:

```
$ node --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts --scan --json --root .
$ python3 -c "… intersection of allReferencedScripts with the snapshot's after.dead …"
committed after.dead (15): candidate-synthesis.ts coupling-graph.ts deliver-verify-usage.sh
  dual-source-check.ts overhead-instrument.sh proposal-convergence.ts refresh-worktree-quay.sh
  run-namespace-sweep-kill.mjs serial-fanin-absorb.ts stale-ready-audit.ts state-worded-clause-check.ts
  test-file-baseline.ts tmux-session.ts tmux-test-isolation-check.ts workflow-replay.ts
OVERLAP (violations): ['dual-source-check.ts']      # ⇒ this ONE literal is the whole violation
{"script":"dual-source-check.ts","carrier":{"file":"plugin/test/discovery-method-registry.test.mjs",
 "line":514,"snippet":"\"fan-in-ff-protocol-check.ts\", \"fan-in-queueing-model.ts\", \"dual-source-check.ts\", …"},
 "kind":"test-pin"}
```

**⛔ The precedent fix — refreshing the snapshot — is NOT available here, and that is MEASURED, not
assumed.** `tasks/gap-ac253-session-primitives-shared-layer-adoption.md` cleared the same red by
recomputing the snapshot; on this tree the recompute turns the one violation into two DIFFERENT ones:

```
$ node --experimental-strip-types plugin/scripts/registry-bare-filename-scan.ts --dead-set --root . --write /tmp/dead-set-probe.json
dead-set recompute: before=20 → after=20 (extracted 0: ∅)
window 2026-10-09T07:17:35.284Z → 2026-10-12T07:17:35.284Z (72h); universe 373
$ cp /tmp/dead-set-probe.json docs/analysis/dead-set-recomputed.json && node … --check --root .
RED: referenced script(s) still in dead set: worktree-deps-provision.sh, worktree-deps-provision.ts
$ echo $?
1
```

(The snapshot was then restored byte-identical — `cp` back from a pre-probe copy, `git status` clean —
and `docs/analysis/dead-set-recomputed.json` is NOT in this delta.) So refreshing is not a repair
available to this task: it would need the `worktree-deps-provision.{sh,ts}` wrapper pair to leave the
dead set first, which is a §12d archive decision outside this task's ## Touches. ⛔ Neither evasion the
precedent rejects was taken: the checker was not taught to ignore `test-pin`, and the name was not
rewritten into a form the checker cannot see. What changed instead is the FIXTURE (AC2 below) — and
that change is also correct on its own terms: naming a script this test never touches registers a
spurious `test-pin` keep-root in the §12d closure, shielding an unused script from the archive decision.

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
ℹ tests 51   ℹ suites 0   ℹ pass 51   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
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

The seed Experience, `method_id` / `version` / `status` / `expected_invariant` / `falsification` are
transcribed **verbatim** from the landed Phase 2 task's Evidence section
(`gap-discovery-method-reflection-unified-trigger-and-candidate-generation`, §"The full `decision` /
`candidate` output for the 4 named cases"); the seed Experience is the same section's re-derived ledger
digest, whose signature line is `found-and-fixed|<the two seed paths>` →
`EXP-fan-in-lock-hold-pairing`, `source_ref=outcome-31fc82ad5d6c1f86`, `verdict=supported`.
`operation.steps` / `applicability` / `cost_budget` were NOT pasted and are reconstructed (generic text,
naming no seed). ⛔ Neither carrier survives on disk — `.quay/discovery-*.jsonl` is a gitignored runtime
family — so the paste is the only remaining trace of the real run, and the provenance is cited by
`case_id` (the form the evidence prints) rather than by the content-addressed ledger `id`.

⚠️ **`operation.tools` is the ONE field that is not fully verbatim: the pasted list's third entry
(`dual-source-check.ts`) is not reproduced in the fixture** — the mechanical reason is the section
above (a bare `plugin/scripts` basename literal under `plugin/test/` is a `test-pin` reference, and
that script is in the committed §12f dead set ⇒ the whole-suite static gate dies in the static phase
before any test runs). The two SEED entries and their order are exact, and what the case judges is
unchanged: the refusal must name exactly those two. `plugin/test/discovery-method-registry.test.mjs:521-529`
records the same note at the field itself.

```
ledger entry: {"ok":true,"id":"experience-f534df15e5fcf465"}
catalog: defaultToolNames() ok=true names=392 (REAL, not a fixture)
every tool of the record is a real catalog entry: true
seed components: ["fan-in-ff-protocol-check.ts","fan-in-queueing-model.ts"]
validateMethodRecord(v2): {
 "ok": false,
 "reasons": [
  "TOOL_IS_SUBJECT:fan-in-ff-protocol-check.ts",
  "TOOL_IS_SUBJECT:fan-in-queueing-model.ts"
 ]
}
names BOTH seed files: true
appendMethodRecord(v2): {"ok":false,"reasons":["VERSION_NOT_MONOTONIC:shared-contract-divergence-expects-1-got-2","TOOL_IS_SUBJECT:fan-in-ff-protocol-check.ts","TOOL_IS_SUBJECT:fan-in-queueing-model.ts"]}
registry lines written: 0
```

⚠️ The tool catalog used here is the **REAL** one (`defaultToolNames()`, 392 names, read from the
declarations carrier), not a fixture: that is the point — every name in this record is a genuine
catalog entry, so the OLD contract accepted the record and only the provenance can refuse it. The
scoping claim ("the rule is not `refuse the record`") is asserted **structurally** — over the record's
own tool list, refused ⇔ provenance component — rather than by naming the surviving instruments here,
for the same mechanical reason the third entry is absent. The same reading is pinned as a re-runnable
case: `✔ AC2 (real control): the Phase 2 v2 record is refused with TOOL_IS_SUBJECT naming BOTH seed
files`, and the append path refuses the same record with the same two codes plus the version code,
writing nothing (`registry lines written: 0`).

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
$ grep -n -E 'fan-in-ff-protocol-check|per-task-suite-record|checker-io|touches-parser' plugin/test/discovery-method-registry.test.mjs | head -6
485://     `["fan-in-ff-protocol-check.ts","fan-in-queueing-model.ts","dual-source-check.ts",
502:  components: Object.freeze(["plugin/scripts/fan-in-ff-protocol-check.ts", "plugin/scripts/fan-in-queueing-model.ts"]),
527:      "fan-in-ff-protocol-check.ts", "fan-in-queueing-model.ts", "mirror-pair-drift-check.ts",
554:  assert.deepEqual(seeds.component_basenames, ["fan-in-ff-protocol-check.ts", "fan-in-queueing-model.ts"]);
561:    `${TOOL_IS_SUBJECT}:fan-in-ff-protocol-check.ts`,
580:    `${TOOL_IS_SUBJECT}:fan-in-ff-protocol-check.ts`,
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
    actual: true,
    expected: false,
--- reverted (cp back from the pre-mutation copy) ---
$ md5sum docs/analysis/discovery-method-registry.mjs /tmp/ac4-before.mjs   # AFTER == BEFORE
f808064e4bb127fcd9d9d3654d74d469  docs/analysis/discovery-method-registry.mjs
f808064e4bb127fcd9d9d3654d74d469  /tmp/ac4-before.mjs
$ node --test --test-name-pattern="AC1\(a\): a tool equal" plugin/test/discovery-method-registry.test.mjs
✔ AC1(a): a tool equal (by basename) to a provenance component ⇒ TOOL_IS_SUBJECT
ℹ pass 1   ℹ fail 0
$ git status --short          # after the revert: empty
```

Case (a) reads `ok:true` (accepted) with the rule disabled and `ok:false` with it enabled — the
assertion is caused by the rule, not by the surrounding record. The revert is proved by md5 equality
with the pre-mutation copy (kept outside the worktree, in `/tmp`, so it never enters the delta). The
module under test is byte-identical to the previous round's (`f808064e4bb127fcd9d9d3654d74d469`) —
this round changed only the test fixture.

### DoD — `scripts/test.sh --for-task gap-discovery-method-record-tool-vs-subject-leak --allow-thin`

```
$ bash scripts/test.sh --for-task gap-discovery-method-record-tool-vs-subject-leak --allow-thin
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: run_checker "checked-in-write-check" … --changed --root <worktree>
  scoped check: run_checker "task-contract-check" … --no-block --strict-subset <task file>
  scoped check: run_checker "malformed-task-check" … --strict-subset <task file>
  scoped check: run_checker "touches-one-entry-one-path-check" … --strict-subset <task file>
  scoped check: run_checker "import-graph-check" … --root <worktree>
  scoped check: run_checker "sh-census-check" … --root <worktree>
  scoped check: run_checker "test-file-snapshot-check" … docs/analysis/test-file-baseline.txt
  … (17 scoped checks total; no STATIC_CHECK_FAILED, no STATIC_CHECK_NOT_EVALUATED)
task-contract-check: no violations.
violations: 0 unique across 0 task(s); info findings (non-ratchet, pre-opt-in baseline): 2 — see --json for details
test-isolation-check — 983 glob file(s), 21 current violation(s) [all 21 baselined; the list can only get SHORTER]
✔ (both discovery test files)
ℹ tests 51   ℹ pass 51   ℹ fail 0
SCOPED_EXIT=0
```

This is the gate that killed the previous round, run on the final tree: the static phase now completes
and the scoped gate exits 0.

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
  routine, no change to the ledger module, no change to `registry-bare-filename-scan.ts`, and no
  re-validation or rewrite of any already-written carrier. `docs/analysis/dead-set-recomputed.json` is
  untouched.

### Observation for the §12f owner (reported, NOT worked around here)

The snapshot refresh that the ac253 precedent used is currently unreachable from ANY tree: the
recomputed dead set contains the `worktree-deps-provision.{sh,ts}` pair, whose only references are each
other's `wrapper-delegate` edge — a kind that `computeKept` deliberately does not treat as a keep-root
(`registry-bare-filename-scan.ts:868-870`) while the `--check` gate DOES count it in
`allReferencedScripts`. So `after.dead ∩ allReferencedScripts ≠ ∅` for that pair no matter which
snapshot is committed, and the gate can only stay green while the snapshot predates them. This task
does not touch that checker (not in ## Touches); it is recorded so the next §12f work starts from the
measured reading rather than from a retry.

## Blocker

**2026-10-12T07:15:02.690Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 84
- run_id：wk-prod-anchor
- session_id：522653ec-f72d-418b-aa3b-82ce73971f0f

（真因与修法见 Evidence §"Why the previous round did not land"：`# tests 0` ⇒ 套件在静态闸中止，
唯一真因是被 AC2 fixture 逐字携带的 `dual-source-check.ts` 裸文件名命中 §12f 死集闸。）

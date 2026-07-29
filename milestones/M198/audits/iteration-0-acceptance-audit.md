# DIR-119-D1 / M198 — Iteration-0 Adversarial Acceptance Audit

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Verdict: REFUTED**

Fresh context — this audit had not seen the Build. All claims below are verified against real
artifacts (git history, live command output, source reads), not the implementer's self-report.

## 1. AC satisfaction (refute-first)

Task file: `tasks/DIR-119-D1.md`. 18 numbered AC bullets. Build's own commit (`eaed20a`) ticked 14
`[x]` and left 4 `[ ]` (AC1, WIRING CLAIM 3, WIRING CLAIM 4, legacy golden-replay).

### Independently re-verified as genuinely met (14 items)

| AC | Claim | Independent verification |
|---|---|---|
| AC2/AC13 | `checkCompositeContract()` called before write, RED fixture for rejection, temp-file-plus-rename, output matches in-memory on success | Read `composite-manifest-synthesis.ts:514-527` — `checkCompositeContract` runs before `fs.writeFileSync(tmp)`/`fs.renameSync`. Test `"CLI: successful run writes via temp-file-plus-rename, content matches in-memory synthesis"` at `composite-manifest-synthesis.test.mjs:211` asserts `JSON.stringify(written.manifest)===JSON.stringify(expected.manifest)` — real, not a stub. Two more RED-fixture CLI tests (contract-violation, prohibiting-edge) confirmed present and passing. |
| AC3/AC12 | Reuses (not reimplements) `parseTouches`/`expandGlobs`/`filesDisjoint`/`buildCouplingGraph`/`deriveInternalOrderEdges`/`hasProhibitingEdge`; real export name is `hasProhibitingEdge`, not `isProhibiting` | `grep -n "^import"` on the module confirms all six imported from the two named files, zero local reimplementation. `grep -n "^export"` on `coupling-graph.ts` confirms `hasProhibitingEdge` (line 164) is real; `isProhibiting` is confirmed to belong to `candidate-contracts.ts`, imported internally by `coupling-graph.ts`, not re-exported. |
| AC4 | Missing-manifest composite dispatch hits the EXISTING vacuous-pass path (`ok:true`), not a fabricated fail-closed rejection | `composite-preflight.ts`'s own selftest/comment confirms `new-shape-no-manifest-vacuous-pass`. Test `"AC4: a composite call missing compositeManifestFile hits the EXISTING vacuous-pass path..."` present and passing. Grep confirms the two reason codes the ORIGINAL task-body wording named do not exist anywhere in the codebase — the correction is real, not a paper-over. |
| AC5/AC16 | `DEFAULT_SYNTHESIS_CAPACITY` is a real named constant; `context.capacity` populated only with the `CapacityLimits` subset the checker validates | Read `composite-contracts.ts:50-56` — `CapacityLimits` really has only `{maxPhases, maxAuditShards, taskLineEstimates?, maxTotalLines?}`, no `maxParallelAgents`/`landPolicy`. Read `composite-manifest-synthesis.ts:66-71,266-267` — `DEFAULT_SYNTHESIS_CAPACITY` exported with all 4 fields; only the valid subset flows into `context.capacity`. |
| AC6/AC14 (source-read half) | `select-preflight.js` passes the real `portfolio` field through | `git show eaed20a -- .claude/workflows/select-preflight.js` — real diff threading `PreflightResult.portfolio` into the returned JSON schema (`portfolio: { type: 'object' }`), not a hand-shaped stub. |
| AC7/AC15 (doc-grep half) | `OUTER-LOOP.md`'s `execute()` step names `taskIds.length > 1`, invokes the synthesis CLI, threads `compositeManifestFile` | `git show eaed20a -- experiments/quay-perpetual-stream/OUTER-LOOP.md` — real added paragraph containing the literal CLI invocation and threading language. |
| AC8/AC9 | Manifest exercised on a real-task-facts candidate; disjoint Touches produce >1 phase | `milestones/M198/evidence/proof-manifest-DIR-100+DIR-101.json` — real 2-phase manifest for `DIR-100`+`DIR-101`. Confirmed both tasks are real, currently `status:todo`, with genuinely disjoint `## Touches` (`packages/quay/src/gate/config/loader.ts` vs `packages/quay-native/*`) by reading `tasks/DIR-100.md`/`tasks/DIR-101.md` directly. `composite-preflight-check-output.txt` shows the real, unmodified `composite-preflight.ts` confirms `{"ok":true,"isComposite":true,"contractViolations":[]}` against this manifest. **See CONCERN below** — the candidate object itself was hand-assembled, not literally SELECT-produced. |
| AC10 | Test file RED/GREEN: fusion, fail-toward-fusion, deterministic sorted output, temp-file-plus-rename fail-closed, PLUS the prohibiting-edge scenario | Ran `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/composite-manifest-synthesis.test.mjs` live: **15/15 pass**, 0 fail. Test names match every claimed scenario, including `"a hasProhibitingEdge pair fails BEFORE union-find, unit-level direct call (AC17)"`. |
| AC11 | Canonical/`plugin/` mirrors byte-identical | `cmp` on both the `.ts` module and the `.test.mjs` file — zero output, exit 0 (identical) for both. |
| AC17 | Prohibiting-edge exclusion honestly scoped to unit-level (real SELECT candidates can never structurally contain such a pair) | Read `candidate-synthesis.ts` — `anyProhibitingPairIn(...)` pruning confirmed at both call sites (lines 161, 186), matching the claim exactly. |

Also independently confirmed, beyond the AC table: the "no other writer in this codebase uses
`renameSync`" claim underpinning AC13's Key-design-decision text — `grep -rln "renameSync"`
across `experiments/`, `plugin/`, `packages/`, `.claude/` returns only this module's canonical
and mirror copy.

### Correctly left unchecked (4 items) — not independently satisfiable this session

AC1 (real production callsite requires a live multi-task dispatch), WIRING CLAIM 3 / AC14's
live-run half, WIRING CLAIM 4 / AC15's live-run half, and the legacy golden-replay item all
require either a real multi-task `execute-milestone.js` dispatch or a live `select-preflight.ts
--json` baseline. Independently reproduced the blocking defect: running
`select-preflight.ts --json` live in this session halts with `FAIL-CLOSED: could not read task
store (quay task list --json failed)` and `portfolio.selected: []` — confirmed genuine
(`milestones/M198/evidence/select-preflight-real-run.json`/`.stderr.txt` match this session's own
re-run). Correctly left `[ ]`; the disclosure is honest, not evasive.

### CONCERN (does not by itself refute, but flagged)

AC8/DoD-2's `[x]` rests on a **hand-assembled** `{candidateId, taskIds:["DIR-100","DIR-101"]}`
object built from real task facts, not the literal output of `select-preflight.ts`'s
`synthesizeCandidatePortfolio()`. AC8's literal text says "REAL SELECT-produced
`MilestoneCandidate`." The Plan's own Stage 7 text pre-authorizes a real-task-facts fallback for a
*width-1* live result; the actual trigger here (a total halt) is a stronger failure than
contemplated, but the substitution is honestly disclosed in the same bullet, not silently
smuggled in. Judgment call: accepted as satisfying the Plan's fallback in spirit, not grounds for
REFUTE on its own.

## 2. DoD satisfaction

- "Landed on master" — correctly `[ ]` (Land phase has not run yet).
- "Real, non-fixture synthesis run... exercised end to end with command output" — `[x]`,
  confirmed via the same evidence as AC8/AC9 above.
- "RED/GREEN evidence... contract-violation-rejected-before-write... fail-toward-fusion" — `[x]`,
  confirmed: both scenarios present and passing in the live 15/15 test run.
- "A fresh independent audit confirms the real production callsite" — correctly `[ ]` (this audit
  could not confirm a live production callsite either, for the same reason Build could not).

## 3. A genuine, previously-undisclosed regression (the REFUTE finding)

Running the canonical `scripts/test.sh` full-suite entrypoint (per CLAUDE.md, the single owned
glob including `plugin/test/*.test.mjs`) surfaces a real, currently-live failure on `master`:

```
✖ M136 (DIR-070-A): sync-vendor.sh --check dynamic scanning verifies all managed files with no hardcoded lists
  AssertionError [ERR_ASSERTION]: --check must report exactly 22 identical concurrency scripts (dynamically scanned from SYNC_SCRIPTS array)
  24 !== 22
```

Root cause, independently traced: this milestone's own commit (`eaed20a`) added
`composite-manifest-synthesis` and `gate-script-base` to `plugin/scripts/sync-vendor.sh`'s
`SYNC_SCRIPTS` array — **neither file is in `tasks/DIR-119-D1.md`'s declared `## Touches`
list** — bringing the real count from 22 to 24, without updating
`plugin/test/plugin-packaging.test.mjs`'s hardcoded `assert.equal(okCount, 22, ...)` (a test that,
by its own inline comment history, has been bumped at every prior milestone that touched
`SYNC_SCRIPTS`, e.g. M188 +5, M189 +7, M191 +2, M193 +1 — this milestone's own +2 was not
recorded).

Confirmed not pre-existing: `git show eaed20a~1:plugin/scripts/sync-vendor.sh` has exactly 22
concurrency entries, and the parent commit's own copy of the test already asserted 22 (i.e. it
passed before this commit). Reproduced live, in isolation (no resource contention):

```
$ bash plugin/scripts/sync-vendor.sh --check | grep -c "OK (identical): scripts/"
24
$ node --test plugin/test/plugin-packaging.test.mjs   # M136 subtest fails, 24 !== 22
```

Build's own iteration-0 report ("390+ pass, 0 fail observed") is accurate as far as it actually
ran, but its regression sweep stalled on the unrelated, separately-disclosed
`build-dist-smoke.test.mjs` hang before ever reaching `plugin/test/plugin-packaging.test.mjs`
(confirmed: that file sorts alphabetically after `build-dist-smoke.test.mjs` in the `packages/quay`
glob segment, and the iteration-0 report itself says the run got only "through ~85 of ~89 files").
The 0-fail claim is therefore incomplete evidence dressed as complete evidence — exactly the
"prose vs proof" pattern DIR-026 Reading A exists to catch, even though nothing here was
deliberately falsified.

This is a real, reproducible, currently-live defect on `master` introduced by this milestone,
undisclosed anywhere in the task's AC/DoD checkboxes or Build's own iteration-0 report — sufficient
by itself to REFUTE.

## 4. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-119-D1 \
    experiments/quay-perpetual-stream/charters/M198-dir119d1-manifest-synthesis.md \
    milestones/M198/absorb-entry.md
...
FAIL: clause0-ac-dod-present: checklist-form AC has 4 unchecked item(s) remaining (REFUTED-equivalent...)
FAIL: DoD check failed — 1 clause violation(s) found (see above).
EXIT: 1
```

Non-zero exit — REFUTED by construction, independent of and consistent with section 3's finding.
All other clauses (1,2,3,4,5,6,7,8,10,11,12; clause9 N/A) PASS.

## 5. Write-backs performed

- `tasks/DIR-119-D1.md`: no AC/DoD checkbox states changed (Build's 14 `[x]`/4 `[ ]` are all
  independently correct); added an `## Audit disposition` section documenting the REFUTED verdict,
  the sync-vendor.sh regression, and the AC8 CONCERN.
- `milestones/M198/absorb-entry.md`: appended `adversarial-audit disposition: REFUTED` line (with
  full reasoning) and a `V_meta consolidation-lag` line carrying the verbatim result of
  `vmeta-lag-check.sh --counter 194 experiments/quay-perpetual-stream/v-meta-ledger.md`
  (`PASS: no confirmed-unconsolidated row past K without a dated carry-forward`, run live this
  pass) — both written BEFORE running the mechanical gate in section 4.
- `experiments/quay-perpetual-stream/dashboard.md`: added a deviation row (see below).

## 6. Deviation-log write-back (DIR-017 Step 3)

Added to dashboard.md's "Homeostatic variables (DIR-017 Step 3)" Deviation rows table:

| level | caught-by | caught-at | description | status | age |
|---|---|---|---|---|---|
| REFUTED | machine | M198 | DIR-119-D1 (M198) Build commit `eaed20a` added `composite-manifest-synthesis`/`gate-script-base` to `plugin/scripts/sync-vendor.sh`'s `SYNC_SCRIPTS` (both outside the task's declared `## Touches`) without updating `plugin/test/plugin-packaging.test.mjs`'s hardcoded `okCount===22` assertion — real count is now 24, test fails live on `master`. Caught by this same iteration-0 adversarial acceptance audit (session `9b3ffa31-5bd7-4274-86f3-74def2f0a1f1`), not by Build's own regression sweep (which stalled on the unrelated `build-dist-smoke.test.mjs` hang before reaching this file). Fix: bump the hardcoded count to 24 (or make the assertion derive its expected count from `SYNC_SCRIPTS.length` directly, closing this whole class of drift) and re-run the full suite clean. | open | 0 |

## 7. Human verification questions (from the task file) — audit's own answers

1. Does `composite-manifest-synthesis.ts` have a real, non-test, non-selftest production caller
   now? **Not yet provably** — the doc-text/source-read edits are real, but no live multi-task
   dispatch has exercised the path end to end in this environment (blocked by the disclosed
   `select-preflight.ts` `getTaskList()` timeout defect, independently reproduced by this audit).
2. Does synthesis produce >1 phase for a real, disjoint-Touches candidate? **Yes**, confirmed via
   `milestones/M198/evidence/proof-manifest-DIR-100+DIR-101.json` (`phases.length===2`) against
   two real `status:todo` tasks with genuinely disjoint `## Touches`.
3. Does a missing/invalid manifest still hit the existing vacuous-pass path? **Yes**, confirmed via
   direct test run and source read of `composite-preflight.ts`.

---
id: gap-architecture-discovery-shadow-space-and-time-not-in-repo
title: Land the two architecture-discovery shadow instruments (cross-object
  consistency, failure recurrence) as read-only analysis tools
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples
---
## Proposal
On 2026-10-11 a bounded shadow experiment ran from `/data/home/yale/work/quay-scratch/arch-discovery-shadow/` (`lib.mjs`, `expA.mjs`, `expA3.mjs`, `expB.mjs`, `labels-A.json`, `labels-A.SOURCES.md`; reports in `out/*-report.json`). It is read-only, it does not use a new runner or scheduler, and every record goes through the production evidence-store validator. The rules below were pre-registered before the first run. The tools live outside the repo, so nothing reproduces them. This task lands them as `docs/analysis/` instruments in the same style as the `ownership-active-*` analysis scripts: a manual CLI with no driver wiring.

Measured readings (develop `a42c14ef1`):

**Space (expA).** The candidates come from the existing `enum-surface-parity-check.ts` at the pre-fix commit `c010f023a`: registered drift plus `--discover`, 17 candidates in total. The checker's human `note` and reason text are never read. The rule uses three pieces of evidence, all located by position:
- **E1:** the literal's line was last changed before the authority first contained the missing value (git blame vs git log).
- **E2:** the comment block directly above the literal names a missing value.
- **E3:** a test file names the declared symbol.

The rule is: drift ⇐ E1=stale ∧ ¬E2 ∧ ¬E3; legit ⇐ (E2∨E3) ∧ ¬stale; otherwise undetermined. On the isolated labels:
- TP 3: the three goal `needs-human` surfaces fixed by `gap-goal-needs-human-missing-from-three-goal-surfaces`. The literals date 09-06..09-10, and the authority gained the value 09-13. All three are `resolved` at develop.
- FP 0, FN 0.
- TN 1: `serve-dashboard.ts:1009`, where E2 names draft, superseded, and retired.
- 2 honest abstains: `routine-file-gate.ts:375/378`, a complementary partition that the rule cannot see.

Cost: 3.0s and 128 git calls.

Known weakness: E3 matches by bare name. Two candidates bound a generic local (`partial` with 70 test hits, `named` with 197). `start-drivers-kinds`' "legit" verdict rests on `DRIVER_KINDS` test hits that may refer to the authority's own symbol.

**Time semantics (expA3).**
- Done-flip commit time vs gate `complete`: 1095 pairs. Commit offsets are mixed: 1535 `+00:00` and 334 `+08:00`, the latter from 09-23 on.
  - The pre-registered single-offset rule returned `unexplained`.
  - A post-hoc stratification (declared as such): in the `+08:00` stratum, the naive median is 8.0h and the TZ-aware median is 0.0002h. This is a representation difference and a counterexample to "done time drifts".
  - In the UTC stratum, 89 of 761 pairs differ by more than 0.5h. These are tasks with several done-flip commits and one `complete`. This is a hypothesis only.
- Round-carrier `in_flight_task_starts` vs outcome `started_at`: 2187 pairs, p90 0.001s, verdict consistent. The `/proc` source was not evaluated because no workers were in flight.

**Time (expB).** 791 suite-red rows (825 file events), 109 needs-human→todo retreats, 696 journal oom-kills, 87 worker-loop starts, 199 orphan finalisations.
- Grouping key is file + normalised signature. 101 groups, 7 recurrent (≥2 tasks within 48h). 14 counterexamples where a file-only key would wrongly merge, and 20 where a signature-only key would wrongly merge across files.
- B1, the reaper: using only events before 10-09T11:31Z, the tool finds the recurrent group (14 events, 10 tasks), locates change `6cc0ee391` by itself, and predicts 0 reds afterwards. Observed: 0 in 50.4h.
- B2: `task-granularity-advice` splits into 2 groups (no signature on 10-07; grep oracle on 10-10). Its assertion dates from `d17753ae9` on 10-07, so the 10-09 fix did not introduce it. A file-only key would have misread the fix as having failed.
- B3: 0 groups span more than one file.
- B4, OOM: 180 of 252 reds fall within 30 min after an oom-kill, 4.0× the shifted control. But a green-suite control shows 3.94×, so red/green = 1.02 and the verdict is "not red-specific (suite-running confound)". This refutes a naive "OOM caused the red" attribution.
- B5: orphan finalisations within 15 min after a worker-loop start are 26.9× the control (94 of 143, across 170 distinct tasks). They are a restart-induced burst, not a per-task recurring defect.
- B6: of the 109 retreats, 1 is linked to a recurrent multi-task group, 57 to single-task reds only, and 51 to no suite red in the prior 7 days. The 109 retreats span 73 tasks; 13 tasks repeat the cycle, up to 7 times.

Constraints carried into the implementation:
- No cause enumeration is written to tasks. The human ruling of 2026-09-20 at `driver-filters.ts:871-883` stands.
- Outputs are shadow records only. The tool creates no task or goal.
- Objects are never merged by literal similarity: merging needs shared-intervention evidence, as the two reaper signatures share the change `6cc0ee391`.

## Plan
1. `docs/analysis/arch-discovery-space.mjs`: expA plus the A3 time-semantics controls. Import the checker and the evidence store; take `--root`, `--pre <rev>`, `--post <rev>`, and `--labels <file>`, and read labels only in the scoring step. Fix E3 to count a test only if it imports the literal's own module (resolve the import specifier) rather than matching by name. Report the result both with and without this fix.
2. `docs/analysis/arch-discovery-time.mjs`: expB with B1–B6 and the green-suite control. Take `--root`, `--cut <iso>`, and `--file <test path>` to parameterise B1 instead of hardcoding the reaper path.
3. Write records using the store's discovery verdicts, its `counterexample` kind, and its carrier provenance (the dependency task). Write to a caller-given path. Do not write to `.quay/architecture-evidence-store.jsonl` by default.
4. Add fixture tests for the decision rules: stale / legit / undetermined; signature split vs file-only merge; a green control that refutes an association; the B1 prediction refuted when one post-change red is injected.
5. Add `docs/analysis/arch-discovery-shadow-report.md` with the readings regenerated at landing time, the pre-registered rules, the post-hoc items marked as such, and the cost.

## Acceptance Criteria
- [x] `node --test plugin/test/arch-discovery-space.test.mjs plugin/test/arch-discovery-time.test.mjs` exits 0, covering the four fixture families in Plan step 4.
  - Evidence (worktree `gap-architecture-discovery-shadow-space-and-time-not-in-repo`): `TEST_EXIT=0`, `tests 21 / pass 21 / fail 0 / cancelled 0 / skipped 0`, `duration_ms 59.5`. Families: (1) `rule: E1=stale ∧ ¬E2 ∧ ¬E3 ⇒ drift-hypothesis`, `rule: (E2 ∨ E3) ∧ E1≠stale ⇒ legit-difference`, `rule: everything else ⇒ undetermined — including stale-with-a-named-comment`; (2) `E3 (old, by bare name) counts a generic local in ANY test` vs `E3 (fixed) counts ONLY a test that imports the literal's own module — a 197→1 collapse`; (3) `grouping key: file+signature keeps two signatures on ONE file apart; file-only merges them` + `B2: a real split reports split; the file-only mutation reports merged(refuted)`; (4) `B4: reds enriched 4× AND greens enriched the same ⇒ the red-specific association is REFUTED` + `B1: ONE post-change red refutes the prediction`. Two further cases validate the emitted record forms against the production store.
- [x] Production reading, space: `node --experimental-strip-types docs/analysis/arch-discovery-space.mjs --root /data/home/yale/work/quay --pre c010f023a --post develop --labels <labels>` reports TP=3, FP=0, FN=0 on the six labelled candidates. Paste the per-candidate table with E1/E2/E3, verdict, and post state.
  - Evidence (run at landing, `--labels /data/home/yale/work/quay-scratch/arch-discovery-shadow/labels-A.json`; the built-in `DEFAULT_LABELS` is identical):
    ```
    arch-discovery-space: pre=c010f023a post=ed24554bf candidates=17 git_calls=134 wall_ms=4263 e3_mode=import
    verdict           post            E1             E2                    E3=fix/name  candidate
    undetermined      persisting      authored-after []                    0/40         start-drivers-kinds
    drift-hypothesis  persisting      stale          []                    not-evaluated/not-evaluated claude-md-driver-kind
    undetermined      persisting      authored-after []                    not-evaluated/not-evaluated drivers-skill-kind
    drift-hypothesis  resolved        stale          []                    not-evaluated/not-evaluated native-goal-write-desc
    drift-hypothesis  resolved        stale          []                    0/0          serve-goal-status-order
    drift-hypothesis  resolved        stale          []                    0/0          serve-goal-status-tabs
    undetermined      persisting      authored-after []                    not-evaluated/not-evaluated discovered:packages/quay/src/mcp-handlers.ts:954
    undetermined      persisting      not-evaluated  []                    not-evaluated/not-evaluated discovered:packages/quay/src/mcp-server.ts:543
    legit-difference  persisting      authored-after ["draft","superseded","retired"] 1/1          discovered:packages/quay/src/serve-dashboard.ts:1009
    undetermined      persisting      not-evaluated  []                    1/3          discovered:packages/quay/src/kernel/task-transition.ts:75
    undetermined      persisting      authored-after []                    not-evaluated/not-evaluated discovered:packages/quay-native/src/mcp-server.ts:467
    legit-difference  persisting      authored-after []                    1/1          discovered:plugin/scripts/criterion-failure-attribution-check.ts:105
    undetermined      persisting      authored-after []                    0/70         discovered:plugin/scripts/crystallization-half-life.ts:594
    undetermined      persisting      not-evaluated  []                    1/197        discovered:plugin/scripts/dev-stats-collect.ts:196
    legit-difference  persisting      authored-after []                    1/1          discovered:plugin/scripts/driver-filters.ts:315
    undetermined      persisting      authored-after []                    0/0          discovered:plugin/scripts/routine-file-gate.ts:375
    undetermined      persisting      authored-after []                    0/0          discovered:plugin/scripts/routine-file-gate.ts:378

    [e3_mode=import] TP=3 FP=0 FN=0 TN=1 abstains-on-labelled=2 unlabelled=11
    ```
    TP = `native-goal-write-desc`, `serve-goal-status-order`, `serve-goal-status-tabs`; TN = `serve-dashboard.ts:1009`; the 2 labelled `legit`s (`routine-file-gate.ts:375/378`) are honest abstains. A3 controls (same instrument): `A3a unexplained: flips=1863 paired=1096 naive_median_h=0.00984 aware_median_h=0.000329`; `A3b consistent: paired=2188 p90_s=0.001`. POST-HOC strata (declared as such): `+08:00 n=335 naive_median_h=7.9998 aware_median_h=0.00021` (representation difference, not drift); `+00:00 n=761 aware_over_0_5h=89` (hypothesis only).
- [x] Production reading, time: `node docs/analysis/arch-discovery-time.mjs --root /data/home/yale/work/quay --cut 2026-10-09T11:31:00Z --file plugin/test/worktree-process-reaper.test.mjs` reports: B1 prediction-held, or refuted if a reaper red has since appeared, pasting it verbatim either way; B2 split; B3 = 0; B4 red/green ratio < 2 with the verdict text; B5 enrichment printed. Counts are read at the time of the run and pasted.
  - Evidence (verbatim):
    ```
    arch-discovery-time: head=ed24554bf cut=2026-10-09T11:31:00Z groups=101 recurrent=7 wall_ms=5859
    capture: {"suite_red_rows":791,"suite_red_events_by_file":825,"malformed":0,"nh":109,"oom":698,"worker_loop_starts":87,"orphan_finalisations":199}
    B1 prediction-held: file=plugin/test/worktree-process-reaper.test.mjs pre_events=14 pre_tasks=10 change=6cc0ee3919 2026-10-09T19:23:02+08:00 observed_after=0 window_h=50.8
    B2 split: [{"sigKey":"nosig","events":3,"first":"2026-10-07T07:50:14.653Z"},{"sigKey":"311a83b0ca46","events":3,"first":"2026-10-10T11:47:01.924Z"}]
    B3 groups_spanning_files=0
    B4 not-red-specific (suite-running confound): oom_kills=698 eligible=252 real=180 control_mean=45 enrichment=4 green_enrichment=3.96 red_over_green=1.01
    B5 restart-induced-burst: worker_loop_starts=87 orphan_finalisations=199 real=94 control_mean=3.5 enrichment=26.86 orphan_tasks=170
    B6: retreats=109 distinct_tasks=73 repeat_cycles=13 max_cycles=7 link={"preceded_by_recurrent_multi_task_group":1,"preceded_by_single_task_reds_only":57,"no_suite_red_in_7d":51}
    ```
    B1 holds with 0 reds in the 50.8h since `6cc0ee3919`; B2 splits; B3 = 0; B4 `red_over_green=1.01 < 2` with the verdict text `not-red-specific (suite-running confound)`; B5 enrichment `26.86` printed.
- [x] Negative control, space: with the E3 import-resolution fix, paste the verdicts for `crystallization-half-life.ts:594` (symbol `partial`) and `dev-stats-collect.ts:196` (symbol `named`) together with their E3 hit counts before and after the fix.
  - Evidence — `--e3-mode name` (no fix) vs `--e3-mode import` (the fix), same PRE/POST:
    | candidate | symbol | E3 by bare name | E3 with the fix | verdict, no fix | verdict, fixed |
    |---|---|---|---|---|---|
    | `discovered:plugin/scripts/crystallization-half-life.ts:594` | `partial` | 70 | **0** | `legit-difference` | `undetermined` |
    | `discovered:plugin/scripts/dev-stats-collect.ts:196` | `named` | 197 | **1** | `undetermined` | `undetermined` |
    ```
    [e3_mode=name]   legit-difference  persisting  authored-after []  70/70   discovered:plugin/scripts/crystallization-half-life.ts:594
    [e3_mode=name]   undetermined      persisting  not-evaluated  [] 197/197  discovered:plugin/scripts/dev-stats-collect.ts:196
    [e3_mode=import] undetermined      persisting  authored-after []   0/70   discovered:plugin/scripts/crystallization-half-life.ts:594
    [e3_mode=import] undetermined      persisting  not-evaluated  []   1/197  discovered:plugin/scripts/dev-stats-collect.ts:196
    ```
    Six-labelled scoring is unchanged by the fix (`TP=3 FP=0 FN=0` in both modes). `start-drivers-kinds` also moves 40→0, confirming its former "legit" reading was the same artefact.
- [x] Mutation control, time: change the grouping key to file-only. B2 must report `merged(refuted)`. Paste the output, then revert.
  - Mutation: `export const GROUP_KEY_BY = "file+signature";` → `"file-only"`. Output:
    ```
    arch-discovery-time: head=ed24554bf cut=2026-10-09T11:31:00Z groups=46 recurrent=12 wall_ms=5749
    B1 prediction-held: file=plugin/test/worktree-process-reaper.test.mjs pre_events=14 pre_tasks=10 change=6cc0ee3919 2026-10-09T19:23:02+08:00 observed_after=0 window_h=50.7
    B2 merged(refuted): [{"sigKey":"nosig","events":6,"first":"2026-10-07T07:50:14.653Z"}]
    B3 groups_spanning_files=0
    records → .quay/ac-arch-discovery/time-records.jsonl  validator: accepted=39 refused=0 {}
    ```
    **B2 reports `merged(refuted)`** (2 groups collapse into 1 on the file-only key; groups 101→46). The pinning test also goes red under the mutation: `node --test --test-name-pattern "B2" plugin/test/arch-discovery-time.test.mjs` → `tests 1 / pass 0 / fail 1`. Mutation **reverted** (`--e3`/key unchanged; full file re-run green).
- [x] Every record written passes the store validator: refused = 0. Paste the tally.
  - Evidence — validator tallies printed by the tools:
    ```
    space: accepted=154 refused=0 {}
    time : accepted= 57 refused=0 {}
    ```
    `refused = 0` in both; records use the store's discovery verdicts (`supported`/`refuted`/`undetermined`), its `counterexample` kind, and its `carrier:{path,line,line_sha256}` provenance form.

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-architecture-discovery-shadow-space-and-time-not-in-repo` green.
- No task, goal, or production-carrier writes made by the tools.

## Touches
- tasks/gap-architecture-discovery-shadow-space-and-time-not-in-repo.md
- docs/analysis/arch-discovery-space.mjs (new)
- docs/analysis/arch-discovery-time.mjs (new)
- docs/analysis/arch-discovery-shadow-report.md (new)
- plugin/test/arch-discovery-space.test.mjs (new)
- plugin/test/arch-discovery-time.test.mjs (new)

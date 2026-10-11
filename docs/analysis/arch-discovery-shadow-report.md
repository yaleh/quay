# Architecture-discovery shadow instruments — landed readings

Two read-only analysis instruments, landed from the bounded scratch experiment of 2026-10-11
(`/data/home/yale/work/quay-scratch/arch-discovery-shadow/{lib,expA,expA3,expB}.mjs`) so the readings are
**reproducible from the repo** instead of from a scratch dir. Manual CLIs, no driver wiring — the same family
as `ownership-active-*.mjs`.

| Instrument | Answers | Entry |
|---|---|---|
| `arch-discovery-space.mjs` | cross-object consistency: is a surface literal a **stale copy** (drift) or an **intentional subset**? (`expA`) + the `expA3` time-semantics controls | `node --experimental-strip-types docs/analysis/arch-discovery-space.mjs --root <repo> --pre <rev> --post <rev> [--e3-mode import\|name] [--labels <file>]` |
| `arch-discovery-time.mjs` | failure recurrence over real runtime carriers — identity / grouping / recurrence / recovery (`expB`, B1–B6) | `node docs/analysis/arch-discovery-time.mjs --root <repo> --cut <iso> --file <test path>` |

**Structural sandbox.** Both tools create no task, goal, or AC; change no status; edit no code. Their only
persistence is the caller's `--out` JSONL (default `<root>/.quay/arch-discovery-shadow/…`), never
`.quay/architecture-evidence-store.jsonl`. Every emitted record is run through the **production**
`validateRecord` from `architecture-evidence-store.mjs`, and the accepted/refused tally is *reported*, never
assumed. Records use the store's discovery verdicts (`supported` / `refuted` / `undetermined`), its
`counterexample` kind, and its runtime-`carrier` provenance form — all three added by the dependency task
`gap-evidence-store-cannot-record-discovery-verdicts-and-counterexamples`, which each record names in
`provenance_task` and grounds with a carrier line of that task's file.

⛔ No cause enumeration is written to any task (human ruling 2026-09-20, `driver-filters.ts:871-883`).
⛔ Objects are never merged by literal similarity: a merge needs shared-intervention evidence.

---

## Pre-registered rules (fixed before the first run; never tuned to the labels)

**Space (`expA`).** Candidates = the EXISTING `enum-surface-parity-check.ts` at the PRE commit (registered
drift ∪ `--discover`). The checker's human `note`/`reason` text is **never read** (it carries the answer).
Three position-based evidences:

* **E1 lag** — the literal's line was last changed *before* the authority first contained the missing value
  (`git blame` vs `git log --reverse` over the authority file).
* **E2 named** — the contiguous comment block directly above the literal names a missing value.
* **E3 test** — a test file pins the literal's declared symbol.

```
drift-hypothesis ⇐ E1=stale ∧ ¬E2 ∧ ¬E3
legit-difference ⇐ (E2 ∨ E3) ∧ E1≠stale
undetermined     ⇐ anything else, INCLUDING any evidence not-evaluated
```

Store mapping (the domain word stays in the hypothesis statement, never in the verdict):
`drift-hypothesis → supported`, `legit-difference → refuted`, `undetermined → undetermined`.

**Time (`expB`).** identity = file + sorted normalised `suiteSignatures` (signature-less events get `#nosig`
and never merge with signed ones); recurrence = ≥2 distinct tasks inside one 48 h window; B1..B6 as printed
below. B4's association bar is enrichment ≥2 **and** the green-suite control must not be equally enriched.

**Post-hoc items are marked POST-HOC and were added *after* the pre-registered rule returned a non-answer.**
They are reported as such, not presented as pre-registered.

---

## Reading, space — regenerated at landing (`develop ed24554bf`, PRE `c010f023a`)

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
legit-difference  persisting      authored-after ["draft","superseded","retired"] 1/1   discovered:packages/quay/src/serve-dashboard.ts:1009
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

Six candidates carry a human label (`labels-A`, read **only** in the scoring step after every verdict
exists). TP 3 = the three goal `needs-human` surfaces fixed by
`gap-goal-needs-human-missing-from-three-goal-surfaces` (all `resolved` at the POST rev); TN 1 =
`serve-dashboard.ts:1009` (E2 names draft/superseded/retired); the 2 labelled `legit`s on
`routine-file-gate.ts:375/378` are honest **abstains** — a complementary partition the rule cannot see.
**FP 0, FN 0.** The other 11 candidates are unlabelled and reported, not scored.

### E3 fix (negative control): a test counts only if it IMPORTS the literal's own module

The pre-registered E3 matched the declared symbol by **bare name**. Two candidates bound a generic local, so
their verdicts rested on hits that may refer to the authority's own symbol. The fix resolves each test's
import specifiers (extension-swap aware: `./x.js` ≡ `./x.ts`) and requires the resolved path to be the
literal's own module. `--e3-mode name|import` reports both readings.

| candidate | symbol | E3 by bare name | E3 with the fix | verdict, no fix | verdict, fixed |
|---|---|---|---|---|---|
| `crystallization-half-life.ts:594` | `partial` | 70 | **0** | `legit-difference` | `undetermined` |
| `dev-stats-collect.ts:196` | `named` | 197 | **1** | `undetermined` | `undetermined` |

Both collapse to honest abstains once the name-only hits are removed. (`start-drivers-kinds` also moves
40→0, so its former "legit" reading was an artefact of the same weakness.) The six-labelled scoring is
**unchanged** by the fix (TP=3 FP=0 FN=0 both ways).

### A3 — time-semantics controls (same instrument)

```
A3a unexplained: flips=1863 paired=1096 naive_median_h=0.00984 aware_median_h=0.000329
A3b consistent:  paired=2188 p90_s=0.001
```

`A3a` compares done-flip commit time (`git log`) against the gate `complete` event time. The pre-registered
single-offset rule returns **unexplained** (the overall naive median is ≈0 because most commits carry
`+00:00`, where naive == aware). **POST-HOC** stratification (declared as such) explains it:

```
+08:00  n=335  naive_median_h=7.9998  aware_median_h=0.00021  → representation difference, not time drift
+00:00  n=761  naive_median_h=0.0004  aware_median_h=0.0004   aware_over_0_5h=89 (tasks with several
                                                              done-flips and one `complete`) — HYPOTHESIS ONLY
```

`A3b` (`in_flight_task_starts` vs the attempt's `started_at`): 2188 paired, p90 |Δ| = 0.001 s, max 0.024 s
⇒ **consistent**. The `/proc` source is not evaluated (no workers in flight at run time) — reported, not
silently treated as agreeing.

---

## Reading, time — regenerated at landing

```
arch-discovery-time: head=ed24554bf cut=2026-10-09T11:31:00Z groups=101 recurrent=7 wall_ms=5859
capture: {"suite_red_rows":791,"suite_red_events_by_file":825,"malformed":0,"nh":109,
          "oom":698,"worker_loop_starts":87,"orphan_finalisations":199}
B1 prediction-held: file=plugin/test/worktree-process-reaper.test.mjs pre_events=14 pre_tasks=10
   change=6cc0ee3919 2026-10-09T19:23:02+08:00 observed_after=0 window_h=50.8
B2 split: [{"sigKey":"nosig","events":3,"first":"2026-10-07T07:50:14.653Z"},
           {"sigKey":"311a83b0ca46","events":3,"first":"2026-10-10T11:47:01.924Z"}]
B3 groups_spanning_files=0
B4 not-red-specific (suite-running confound): oom_kills=698 eligible=252 real=180 control_mean=45
   enrichment=4 green_enrichment=3.96 red_over_green=1.01
B5 restart-induced-burst: worker_loop_starts=87 orphan_finalisations=199 real=94 control_mean=3.5
   enrichment=26.86 orphan_tasks=170
B6: retreats=109 distinct_tasks=73 repeat_cycles=13 max_cycles=7
    link={"preceded_by_recurrent_multi_task_group":1,"preceded_by_single_task_reds_only":57,"no_suite_red_in_7d":51}
```

* **B1** — blind to any fix: only pre-cut events decide; the tool LOCATES `6cc0ee3919` itself. **0 reds in
  the 50.8 h since** ⇒ prediction-held.
* **B2** — `task-granularity-advice.test.mjs` splits into 2 groups (no signature on 10-07; the grep-oracle
  signature on 10-10). Its assertion dates from `d17753ae9` (10-07), so the 10-09 fix did not introduce it —
  a file-only key would have misread the fix as having failed.
* **B3** — 0 groups span more than one file (structural).
* **B4** — the naive reading is 4.0× enrichment, but the **green-suite control is 3.96×**, so
  `red/green = 1.01 < 2` ⇒ verdict **"not-red-specific (suite-running confound)"**. A naive "the OOM caused
  the red" attribution is refuted: fixtures OOM on purpose.
* **B5** — orphan finalisations are 26.9× enriched after a worker-loop start (94 of 143, 170 distinct tasks):
  a restart-induced burst, not a per-task recurring defect.
* **B6** — of 109 retreats, 1 links to a recurrent multi-task group, 57 to single-task reds only, 51 to no
  suite red in the prior 7 days; 13 tasks repeat the cycle, up to 7 times. Reported as counts, not cause.

Grouping carried 14 file-only-merge counterexamples and 20 cross-file-signature counterexamples — the
evidence that neither a file-only nor a signature-only key is admissible.

### Mutation control

Flipping the grouping key to file-only makes **B2 report `merged(refuted)`** (and the test that pins the
shipped key goes red); the key was then restored. Full output in
`plugin/test/arch-discovery-time.test.mjs` (asserted both ways).

---

## Store validator tally (refused = 0)

```
space: accepted=154 refused=0 {}     (space_records.jsonl)
time : accepted= 57 refused=0 {}     (time_records.jsonl)
```

Both tallies are printed by the tools at the end of every run: a refused record is a reported failure, never
a silent drop.

## Fixture tests

`node --test plugin/test/arch-discovery-space.test.mjs plugin/test/arch-discovery-time.test.mjs` → **21 pass /
0 fail**. Four fixture families: (1) stale / legit / undetermined under the pre-registered rule; (2) the E3
import-resolution fix vs the bare-name reading; (3) signature split vs file-only merge; (4) the green control
refuting an association, and the B1 prediction refuted by one injected post-change red. Records the tools
emit are also validated against the production store, so the test fails if the store's vocabulary drifts away
from what the tools write.

## Cost

| run | wall | git calls |
|---|---|---|
| space (`--pre c010f023a --post develop`) | ≈4.3 s | 134 |
| time (B1–B6, 4 carriers) | ≈5.9 s | 2 (`rev-parse`, one `log` for B1) |

## Known limits (reported, not papered over)

* E1 requires the authority file's history to contain the missing value; otherwise **not-evaluated**. E3 is
  **not-evaluated** when the literal declares no symbol (never a silent zero). E2 is **not-evaluated** when
  the literal cannot be located.
* The E3 fix removes name-only false positives but is still a heuristic: a test that imports the module and
  mentions the symbol name in an unrelated string still counts.
* A3's `/proc` comparison source is not evaluated in a non-resident run.
* B4 needs `journalctl`; if unavailable the run reports **not-evaluated**, never an implicit agreement.

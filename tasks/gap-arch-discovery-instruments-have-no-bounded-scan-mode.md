---
id: gap-arch-discovery-instruments-have-no-bounded-scan-mode
title: "arch-discovery instruments only run as a one-off pre/post experiment: no
  bounded periodic scan mode, unstable finding identity, output dir not
  gitignored"
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
`docs/analysis/arch-discovery-space.mjs` and `docs/analysis/arch-discovery-time.mjs` landed via the done task `gap-architecture-discovery-shadow-space-and-time-not-in-repo`. I re-ran both independently on 2026-10-11 in a worktree pinned at develop `15478f9f3`, and they reproduce:
- **space:** TP 3, FP 0, FN 0, TN 1, 2 abstains; the validator accepted 154 records and refused 0; 4.1 s; 134 git calls.
- **time:** B1 `prediction-held`, B2 `split`, B3 0, B4 red/green = 1.01 (`not-red-specific`), B5 enrichment 26.86; the validator accepted 57 and refused 0; 6.0 s.
- **independent control:** I injected one reaper red after the located change and B1 flipped to `refuted`; injecting the same red before the change kept it at `prediction-held`.

Both tools are shaped as a single experiment, so they cannot run periodically yet:
- **Space needs `--pre`/`--post` plus labels.** A periodic scan has neither; it needs to score the current HEAD alone and run with no labels.
- **Time hardcodes its windows.** `arch-discovery-time.mjs` hardcodes the journal window `--since 2026-09-18` (around `:150`) and `DEFAULT_CUT` (`:33`). B1 is a single prediction for one case.
  - It reads whole carriers into memory. `.quay/gate-events.jsonl` is 144 MB today.
  - It has no wall-time or record cap.
- **Finding identity is not stable across runs.** `subject_key` is stable, but nothing derives a fingerprint that excludes `ts` and fixes the order of (subject_key, verdict, evidence sha256s). So two identical runs cannot be deduplicated.
- **Default output dir is not gitignored.** Both tools default `--out` to `.quay/arch-discovery-shadow/`. `git check-ignore` reports nothing for that path, so every default run leaves untracked files in the shared checkout.

## Plan
1. Add `--scan` mode to both tools.
   - **Space `--scan`:** pre = post = `--rev` (default HEAD); no labels; candidates come from the checker at that rev.
   - **Time `--scan`:** reads only events inside `--since <iso>` (required in scan mode; there is no hardcoded date); the journal is read with the same window. B1 is skipped in scan mode, with an explicit `not-applicable` and the reason. Grouping, recurrence, the file-only/cross-file counterexamples, the B4 green control, and B5 all run inside the window.
2. Bounds, enforced inside the tool. Each one, when hit, makes the tool exit with a distinct non-zero code and append nothing. This is fail-closed: never a partial output.
   - `--max-ms`: wall-time budget.
   - `--max-records`: output cap.
   - `--max-candidates` / `--max-groups`.
   - Stream jsonl carriers line by line instead of `readFileSync` of the whole file.
3. Finding fingerprint: `finding_fp = sha256(subject_key + verdict + sorted evidence sha256s)`, excluding every `ts`, written on each outcome and counterexample record. Two runs on the same inputs must produce identical `finding_fp` sets.
4. Move the default `--out` to a gitignored path, and add the ignore rule to `.gitignore` if needed. Paste the `git check-ignore -v` output.

## Acceptance Criteria
- [x] `node --test plugin/test/arch-discovery-space.test.mjs plugin/test/arch-discovery-time.test.mjs` exits 0, with new cases covering:
  - (a) two `--scan` runs on the same fixture give identical `finding_fp` sets;
  - (b) each bound (`--max-ms`, `--max-records`, `--max-candidates`/`--max-groups`) exits with its own code and leaves the out file byte-identical;
  - (c) time `--scan` without `--since` is refused;
  - (d) B1 reports `not-applicable` in scan mode.

  Evidence — exit 0: `ℹ tests 33 / ℹ pass 33 / ℹ fail 0`. (a) is one case per file: a temp git-repo fixture (space) and a temp `.quay/` workspace (time), each scanned twice, sorted `finding_fp` sets `deepEqual`; the fixture must yield >=1 fingerprint (and space's must yield exactly its 2 known-drift candidates). A separate case pins the property directly: two record sets identical except for `ts` get the SAME `finding_fp`, while a changed evidence hash moves it. (b) space `--max-ms 0`→4, `--max-records 1`→5, `--max-candidates 1`→6; time `--max-ms 0`→4, `--max-records 1`→5, `--max-groups 1`→6 — every run pre-seeds the out file with a sentinel and reads it back byte-identical. (c) exit 2, out file untouched, no default out dir created. (d) `B1.verdict === "not-applicable"` with a non-empty reason, and the outcome record it emits is `verdict: "not-evaluated"`, `rule_verdict: "B1:not-applicable"` — never `supported`.
- [x] Real-data scan, space: `node --experimental-strip-types docs/analysis/arch-discovery-space.mjs --scan --root /data/home/yale/work/quay --out <tmp>`. Paste the per-candidate verdict table, wall ms, and the validator tally. Refused must be 0.

  Evidence (`wall_ms=2804`, 134 git calls in the proposal's run vs 128 here):
  ```
  arch-discovery-space: SCAN rev=e3163e519 candidates=14 git_calls=128 wall_ms=2804 e3_mode=import
  verdict           post            E1             E2                    E3=fix/name  candidate
  undetermined      persisting      authored-after []                    0/40         start-drivers-kinds
  drift-hypothesis  persisting      stale          []                    not-evaluated/not-evaluated claude-md-driver-kind
  undetermined      persisting      authored-after []                    not-evaluated/not-evaluated drivers-skill-kind
  undetermined      persisting      authored-after []                    not-evaluated/not-evaluated discovered:packages/quay/src/mcp-handlers.ts:954
  undetermined      persisting      not-evaluated  []                    not-evaluated/not-evaluated discovered:packages/quay/src/mcp-server.ts:543
  legit-difference  persisting      authored-after ["draft","superseded","retired"] 1/1          discovered:packages/quay/src/serve-dashboard.ts:1009
  undetermined      persisting      not-evaluated  []                    1/4          discovered:packages/quay/src/kernel/task-transition.ts:75
  undetermined      persisting      authored-after []                    not-evaluated/not-evaluated discovered:packages/quay-native/src/mcp-server.ts:467
  legit-difference  persisting      authored-after []                    1/1          discovered:plugin/scripts/criterion-failure-attribution-check.ts:105
  undetermined      persisting      authored-after []                    0/70         discovered:plugin/scripts/crystallization-half-life.ts:594
  undetermined      persisting      not-evaluated  []                    2/199        discovered:plugin/scripts/dev-stats-collect.ts:196
  legit-difference  persisting      authored-after []                    1/1          discovered:plugin/scripts/driver-filters.ts:315
  undetermined      persisting      authored-after []                    0/0          discovered:plugin/scripts/routine-file-gate.ts:375
  undetermined      persisting      authored-after []                    0/0          discovered:plugin/scripts/routine-file-gate.ts:378

  [e3_mode=import] TP=0 FP=0 FN=0 TN=0 abstains-on-labelled=0 unlabelled=14
  finding_fp: 20 distinct over 21 outcome/counterexample rows
  A3 not-applicable: A3 is a one-off time-semantics control from experiment A3; a periodic scan scores the candidate set only
  records -> <tmp>  validator: accepted=120 refused=0 {}
  ```
  Refused = 0. (TP/FP/FN/TN are 0 because scan mode has NO labels — every candidate lands in `unlabelled`.)
- [x] Real-data scan, time: `node docs/analysis/arch-discovery-time.mjs --scan --since <now-7d> --root /data/home/yale/work/quay --out <tmp>`. Paste the group count, recurrent groups, counterexample counts, B4 red/green, B5 enrichment, wall ms, and peak RSS (`/usr/bin/time -v`).

  Evidence (`--since 2026-10-04T14:56:52Z`, run 2026-10-11T14:57Z):
  ```
  groups=51 recurrent=7 wall_ms=3009
  capture: {"suite_red_rows":791,"suite_red_events_by_file":79,"malformed":0,"nh":7,"oom":366,"worker_loop_starts":28,"orphan_finalisations":32}
  B1 not-applicable: B1 predicts a located change from the PRE-CUT window; a periodic --scan has no cut — run the experiment mode (--cut <iso>) for B1
  B2 split: [{"sigKey":"nosig","events":3,"first":"2026-10-07T07:50:14.653Z"},{"sigKey":"311a83b0ca46","events":3,"first":"2026-10-10T11:47:01.924Z"}]
  B3 groups_spanning_files=0
  B4 not-red-specific (suite-running confound): oom_kills=366 eligible=65 real=54 control_mean=16 enrichment=3.38 green_enrichment=3.97 red_over_green=0.85
  B5 restart-induced-burst: worker_loop_starts=28 orphan_finalisations=32 real=26 control_mean=0.5 enrichment=52 orphan_tasks=31
  B6: retreats=7 distinct_tasks=7 repeat_cycles=0 max_cycles=1 link={"preceded_by_recurrent_multi_task_group":1,"preceded_by_single_task_reds_only":1,"no_suite_red_in_7d":5}
  finding_fp: 21 distinct over 22 outcome/counterexample rows
  records -> <tmp>  validator: accepted=40 refused=0 {}
  (Maximum resident set size (kbytes): 265432)
  ```
  Counterexample counts (from `--json`): `file_only_merge_counterexamples=7`, `cross_file_signature_counterexamples=10`. B4 red/green = **0.85** (`not-red-specific (suite-running confound)` — the GREEN control refutes the naive reading). B5 enrichment = **52**. Wall = 3009 ms. Peak RSS = 265432 kB (~259 MB), against a 137.6 MB `.quay/gate-events.jsonl`: the streamed reader's live heap is **5.0 MB** where a whole-file `readFileSync` holds **359.7 MB** (measured directly on the same carrier).
- [x] Determinism on real data: run the time scan twice back to back with the same `--since`, then `diff` the sorted `finding_fp` lists. Paste the diff; it must be empty. If a live carrier grew in between, say so and pin `--until` as well.

  The live carriers DO grow under the running loop, so `--until` was pinned as well (`--since 2026-10-04T14:56:52Z --until 2026-10-11T14:56:52Z`); the two runs were 1 s apart.
  ```
  A n= 22  B n= 22
  $ diff /tmp/ac4-final-fps-a.txt /tmp/ac4-final-fps-b.txt
  DIFF EMPTY (exit 0) — identical finding_fp sets
  081f7c4f07d7a50cbefae533d5e2aa8cbf3190f7aee34cac142b5f63f4a77f57
  09740c1404dba86e2a0f436ca3b8ad0a1abf1da8f4d7579d9e2bc499ea7db90a
  1b200451fe712d4b801c793f6aee843c0d05a3fe7fbcfbd533bdb60219662305
  ```
- [x] `git check-ignore -v <default out path>` prints a matching rule.

  Evidence:
  ```
  $ git check-ignore -v .quay/arch-discovery-shadow/space-records.jsonl .quay/arch-discovery-shadow/time-records.jsonl
  .gitignore:60:**/.quay/arch-discovery-shadow/	.quay/arch-discovery-shadow/space-records.jsonl
  .gitignore:60:**/.quay/arch-discovery-shadow/	.quay/arch-discovery-shadow/time-records.jsonl
  ```
- [x] The experiment mode is unchanged: `--pre c010f023a --post 15478f9f3` still gives TP 3, FP 0, FN 0, and the reaper B1 run still gives `prediction-held`. Paste both outputs.

  Evidence:
  ```
  $ node --experimental-strip-types docs/analysis/arch-discovery-space.mjs --pre c010f023a --post 15478f9f3 --out <tmp>
  [e3_mode=import] TP=3 FP=0 FN=0 TN=1 abstains-on-labelled=2 unlabelled=11
  records -> <tmp>  validator: accepted=154 refused=0 {}

  $ node docs/analysis/arch-discovery-time.mjs --root /data/home/yale/work/quay --out <tmp>
  B1 prediction-held: file=plugin/test/worktree-process-reaper.test.mjs pre_events=14 pre_tasks=10 change=6cc0ee3919 2026-10-09T19:23:02+08:00 observed_after=0 window_h=51.6
  B4 not-red-specific (suite-running confound): oom_kills=700 eligible=252 real=180 control_mean=45 enrichment=4 green_enrichment=3.97 red_over_green=1.01
  records -> <tmp>  validator: accepted=57 refused=0 {}
  ```

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-arch-discovery-instruments-have-no-bounded-scan-mode` green.

## Touches
- tasks/gap-arch-discovery-instruments-have-no-bounded-scan-mode.md
- docs/analysis/arch-discovery-space.mjs
- docs/analysis/arch-discovery-time.mjs
- plugin/test/arch-discovery-space.test.mjs
- plugin/test/arch-discovery-time.test.mjs
- .gitignore

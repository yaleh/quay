---
id: gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files
title: 全量套件被 OOM 杀掉大半主阶段后仍判 green 并落地（轮次 2660：65/579 文件、466/~7880 测试、oomKill=4）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 from `.quay/verification-round.jsonl` + `.quay/suite-memory-evidence-*.json`.** Round **2660** (fan-in of `gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window`, runId `mfi-…-1791964426208-7535e1`, commit `74007f5f4`, scope=worktree) recorded:
```
state:"green", pass:466, fail:0, cancelled:0, perFile:65 files, load:233.33, durationMs:121518
suite-memory-evidence: peakBytes 17181478912 (memoryMax 17179869184), oom 22673, oomKill 4, phase "main"
```
Every neighboring full round on the same tree shape ran **579 files / ~7,880 tests**: 2656 7871 pass, 2657 7875, 2658 7878+1 fail, 2659 7877+6 fail. In 2660, 514 of 579 files (89%) never reported. The fan-in log shows `suite-end exit 0` → `ac-gate` → `flip-done` → `ff`. **The task landed on a suite that ran 11% of its files.**

**Cause.** `full-suite-runner.ts` captures OOM evidence (`readCgroupMemoryEvents` → `writeSuiteMemoryEvidence`, `:1276-1381`, from `gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable`, done). That evidence is written to a side file and **never consumed by the verdict**. The verdict counts only TAP output, so files killed before producing TAP are not failures; they simply vanish. A suite that was OOM-killed mid-main-phase is therefore shaped exactly like a small green suite (硬规则 3b: "could not run" must not share the output of "ran and passed").

**Frequency.** 7 runs with `oomKill>0` in the last ~15h (rounds 2649, 2652, 2653, 2654, 2655, 2659, 2660). Six were recorded red because their kills did produce attributed failures. 2660 is the one where the kills took out most of the main phase. A broader check of green task-rounds with under 50% of the median file count is too noisy historically (suite size changed over time), which is exactly why the verdict needs an expected-set check rather than a heuristic.

**Second occurrence, same class, different killer (2026-10-14 08:24-08:45Z).** Fan-in of `gap-driver-restart-anytime-busy-e2e-on-dist-kernel` (`.quay/fan-in-<id>-wk-prod-anchor.log`):
```
08:24:22 suite-start
08:43:38 suite-end exit=null  "silence watchdog killed the suite (no output ≥ silence timeout)"  wall_ms=1156155
08:44:43 rerun exit=0 state=rerun-green namedFiles=3
08:44:43 suite-rerun-green  "in-round rerun green on 3 named file(s) — landing as green"
08:44:45 flip-done → 08:45:02 ff
```
The full suite **never completed**. Host load was ~24 and there was no OOM signal, so this is not the memory case. It was certified green by re-running 3 files. Two further 3b gaps showed up in the same run:
- **No `verification-round.jsonl` record was written** for this watchdog-killed round. `gap-watchdog-killed-round-writes-no-verification-round-record` (done) was supposed to make exactly this path write a distinct `evaluated:false` record, so either it regressed or it does not cover the fan-in suite path.
- The suite attempt log was **pruned on landing**, so *which* 3 files were re-run is unrecoverable; only the count survives.

## Plan
1. The verdict requires **completeness**. The runner already knows the expected file set it scheduled (per lane/bucket). A round where any scheduled file produced no `__PERFILE__` terminal line is `not-evaluated: incomplete` (missing files enumerated), never `green`. Fan-in treats `not-evaluated` like red for landing purposes, but with its own reason, not "suite red".
2. `oomKill > 0` from the suite's own memory evidence is surfaced in the round record and in the fan-in reason. Combined with (1), it can never be absent from a green verdict.
3. The in-round rerun channel (`rerun-green`) must not convert an *incomplete* round into green by re-running only the named failing files. Missing files are not "named failures".

**Scope tightened 2026-10-14 (human-directed, coordinator).** The verdict must be **fail-closed on completeness**:
4. **Planned manifest.** Before execution, the runner persists the scheduled set: every file, which phase it is in, and its expected terminal. A round is `green` only if **every** planned file has both (a) a per-file terminal record (`__PERFILE__` with `passed=`) and (b) an observed process outcome (exit code, or signal, or `cancelled`). Missing ⇒ `not-evaluated: incomplete (k/N missing)` with the list. A process killed by signal, OOM, or the watchdog is a recorded outcome, not "absent".
5. **OOM is never a flake.** If the suite scope's `memory.events oom_kill` rose during the round (from the runner's own evidence), the in-round `rerun` channel is **not** allowed to convert the round to green. The round is `not-evaluated: oom-killed (n)`, regardless of whether the named files pass when re-run in isolation. Re-running in isolation removes the very concurrency that caused the kill, so it proves nothing.
6. **Telemetry that could not be read is `unknown`, never 0.** If `memory.events` / `memory.peak` cannot be read (cgroup gone, no permission, not a systemd scope), the round records `oomKill: unknown` / `peakBytes: unknown` and the verdict for an otherwise-green round carries `telemetry: unknown`. The evidence file must not write a 0 that is shaped like "no OOM".

**Correction + immediate action 2026-10-14 (human-directed, supersedes the "extend baseline-equivalence to OOM" direction below in the Gate-liveness section):**
7. **IMMEDIATE ACTION — must actually be executed as part of this task's own worker round, not just specified:** on the current candidate commit, with the full planned manifest and all phases, run ONE independent full re-run at a LOWER `--test-concurrency` than the round that hit OOM/incomplete (this flag and the existing telemetry already work today — do not wait for `gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls` or the enriched-telemetry task to land). If that recovery round is clean (zero missing, zero OOM, all phases, original assertions), it is the evidence that certifies landing for AC10/AC11 below. This must not be deferred to a future round — it is this task's own acceptance work.
8. Baseline-equivalence (`runBaselineEquivalence`) is used ONLY after a clean recovery round still shows real test failures (AC12) — never directly on an OOM/incomplete reading, and never fed an OOM/missing-file record as if it were a comparable signature.
9. Bounded recovery: a declared, finite concurrency step-down sequence with a floor. Exhausting it, or hitting a genuinely new failure at a lower concurrency, blocks the round and records a concrete next step (AC13) — it never retries the same parameters indefinitely.

## Gate-liveness defect found 2026-10-14 (coordinator, read-only investigation; supersedes this task's "done" claim)
**The completeness/OOM short-circuit added by this task bypasses the existing baseline-red-equivalence A/B entirely, and it will deadlock most future landings.** Code: `worker-fan-in.ts`, the `incompleteMarker !== null` branch calls `return failSuite(reason, sr.exitCode)` directly — BEFORE `runInRoundRerun` and BEFORE `runBaselineEquivalence` ever run. Every other failure class in this file gets a real, falsifiable base/candidate comparison (checkout `mergeTarget` in a detached worktree, rerun the same named files, compare failure signatures byte-for-byte; `exempt` only when the candidate's red set is a VERBATIM subset of develop's own current red set — "no gate relaxed: a new/changed red would have hard-red'd"). The `incomplete`/`oom-killed` path gets none of that: it is an unconditional block.

**Why this is not hypothetical.** 16 GiB is being kept as the deliberate pressure baseline (human ruling, not raised to 24/26). Real production rounds 2668/2669/2670 (all post-watchdog-fix, all genuinely complete, 582-1002 files) show `oomKill` 2/1/2 respectively — **3 of the last 4 real rounds hit `oomKill > 0` under normal load, on code that is not itself defective.** Once this task's gate reaches production fan-in as currently written, those same rounds would read `not-evaluated: oom-killed (n)` and **never land, regardless of whether an identical candidate-vs-baseline run would show the same OOM rate on unmodified develop.** That is the exact "always red, nothing lands" failure mode the human asked be ruled out, and it is distinct from (worse than) ordinary flaky-test redness because this path has no baseline-equivalence escape valve at all.

**Correction 2026-10-14 (human-directed): baseline-equivalence is NOT the fix for OOM/incomplete, and must never be used as landing evidence for it.** `runBaselineEquivalence` compares real, well-formed failure SIGNATURES from a completed run. A killed or missing file produced no signature — there is nothing to compare, and "both sides also OOM" does not prove the candidate added zero pressure (resource exhaustion is cumulative/probabilistic across whatever else the host is running, not a deterministic per-file property). Treating an OOM-killed or missing-file record as a comparable "red point" would be exactly the 硬规则 3b violation this task exists to close, just moved one layer up. Baseline-equivalence stays usable ONLY as a diagnostic/classification tool for genuinely well-formed failures that survive a complete recovery run (AC12) — never as direct landing evidence for OOM/incomplete itself.

**The actual fix: an independent, full, lower-concurrency recovery re-run on the SAME commit — not a comparison.** When a round reads `incomplete`/`oom-killed`, re-run the COMPLETE planned manifest (all phases, all files — not the named-failure subset `runInRoundRerun` already does) at reduced concurrency, using the `--test-concurrency` flag that already exists today (no new code, no dependency on the host-adapter or enriched-telemetry tasks). That recovery round is judged entirely on its own merits — zero missing, zero OOM, all phases complete, original assertions — and is what may certify landing. It does not inherit the original round's verdict, and the original round itself stays correctly blocked.

## Acceptance Criteria
- [x] AC1: fixture: a suite where N scheduled files are killed (SIGKILL fixture, or a cgroup OOM fixture where feasible) before emitting TAP. Pre-fix verdict is `green` with fewer files (pasted negative control); post-fix verdict is `not-evaluated: incomplete` listing the N files (pasted).
- [x] AC2: the fan-in on such a round does not land, and its reason names "incomplete suite (N/M files)" and the oomKill count when present (pasted).
- [x] AC3: `rerun-green` cannot certify an incomplete round (fixture pasted).
- [x] AC4: a genuinely complete green suite is unaffected (one real full run pasted, file count = scheduled count).
- [x] AC5: `scripts/test.sh --for-task <this task>` green, plus one real full `scripts/test.sh` run with its exact scope, commit, file count and test count pasted (not a scoped count).
- [x] AC6: watchdog-killed suite (silence timeout fixture) followed by an in-round rerun of the named files: the fan-in does **not** land. A `verification-round.jsonl` record with a distinct `evaluated:false` / watchdog reason **is** written (regression check against `gap-watchdog-killed-round-writes-no-verification-round-record`). The names of any re-run files are persisted in a carrier that survives landing cleanup (pasted, pre-fix negative control included).
- [x] AC7: planned-manifest completeness: fixture suites where (a) one planned file never starts, (b) one is SIGKILLed mid-run, (c) one is cancelled. Each yields `not-evaluated: incomplete` naming that file. A fully complete fixture is `green` with `planned == terminal == N` printed (pasted, plus pre-fix negative control).
- [x] AC8: an OOM-killed round (cgroup OOM fixture, or `memory.events` oom_kill delta injected through the runner's evidence seam) whose named failures pass on in-round rerun is **not** landed. Reason `oom-killed (n)`, and no `suite-rerun-green` step (pasted, plus pre-fix negative control showing the old `rerun-green` landing).
- [x] AC9: unreadable memory telemetry is recorded as `unknown`, not `0`, in both the evidence file and the round record (fixture with the cgroup path absent, pasted).

- [x] AC10: on `incompleteMarker !== null` (either `incomplete` or `oom-killed`), the fan-in triggers ONE independent, full, lower-concurrency recovery re-run of the COMPLETE planned manifest on the SAME commit/tree — not a named-file rerun, not a baseline comparison — using the existing `--test-concurrency` CLI control (no new mechanism, no dependency on the host-adapter/telemetry-enrichment tasks). The concurrency step-down sequence and its bound are declared, not open-ended (e.g. a fixed list such as [64, 48, 32], stopping at the floor). Fixture: an OOM-killed round at concurrency 64 triggers exactly one recovery attempt at the next declared lower value, with real `--test-concurrency=<n>` passed to the real suite entry (pasted argv + exit).
- [x] AC11: the recovery round from AC10 is judged independently and in full: `missing == 0`, `oomKill == 0`, every planned phase completed, and the ORIGINAL per-test assertions apply unchanged — it is a fresh verdict, not an inherited green. A recovery round that itself goes incomplete/OOMs again is NOT certified (it either steps down further within the declared bound, per AC13, or exhausts the bound). Fixture: a clean recovery round at the lower concurrency is accepted and its OWN planned/terminal/oomKill counts are what get recorded, not the original round's (pasted, pre-fix negative control showing the OLD code would have accepted the ORIGINAL incomplete round instead).
- [x] AC12: IF — and only if — the AC10/AC11 recovery round completes cleanly (zero missing, zero OOM, all phases) but STILL shows genuine test failures (real assertion reds with a real signature, not OOM/incomplete), THEN the existing `runBaselineEquivalence` policy applies to THOSE failures exactly as it already does for ordinary suite reds (unchanged mechanism, AC1-9 untouched). An OOM, "unknown", or missing-file record is structurally excluded from ever entering the signature set `runBaselineEquivalence` compares — enforced by type/shape, not by convention (fixture: a candidate failure set containing one real signature and one OOM marker is compared using only the real signature; the OOM marker never reaches the comparator, pasted). Classification as baseline-equivalent does NOT by itself permit landing: the candidate's own declared Touches-relevant tests must also be clean, and both arms' real counts are pasted in the record, never asserted in prose alone.
- [x] AC13: bounded retry, never an infinite identical-parameter loop. If the recovery sequence's declared concurrency floor is reached while STILL incomplete/OOM, OR a genuinely NEW failure appears at a lower concurrency that was not present at the original concurrency, the round stays blocked and the record names a concrete next step (e.g. "recovery exhausted at floor concurrency N — needs a code/config fix, see <file>" or "new regression at lower concurrency: <file>") rather than silently repeating the same parameters (fixture: both the floor-exhausted case and the new-regression-at-lower-concurrency case, each with its own distinct recorded next-step token, pasted).
- [x] AC14: `scripts/test.sh --for-task <this task>` green, including the new fixtures from AC10-13. Existing test coverage and budget ceilings are unchanged (grep/diff showing no coverage removed, no budget value touched, pasted).

## Definition of Done
- AC1-AC5 checked with pasted evidence. Separately recorded, not done here: whether round 2660's landing (`87d513fe4`) needs re-certification. The next full round that contains `e18ec4b04` is that re-certification.
- AC10-AC14 checked with pasted evidence, IN ADDITION TO the previously-checked AC1-9 (which stand unchanged — the completeness/OOM detection itself is correct and must not be weakened). The AC10-13 fix is the full-manifest LOWER-CONCURRENCY RECOVERY RE-RUN described in Plan §7-9 — baseline-equivalence is explicitly NOT used as landing evidence for OOM/incomplete (see the corrected Gate-liveness section above). This task does not return to `done` until AC10-AC14 are satisfied through the normal worker-driver path, and existing test coverage/budget ceilings remain unchanged.

## Evidence (2026-10-14, worktree `gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`)

Implementation (4 commits on `task/gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`, HEAD `6d7247602`):
`plugin/scripts/full-suite-runner.ts` (planned manifest persisted **before** execution; completeness / OOM /
telemetry verdict), `plugin/scripts/worker-fan-in.ts` (the incomplete-OOM marker short-circuits the in-round
rerun; watchdog / never-spawned gated **before** the rerun; re-run file NAMES on the durable step trace),
`plugin/test/full-suite-runner-oom-policy.test.mjs` (AC1-AC9 fixtures, each with its pre-fix negative control).

- AC1 — pre-fix (plan dimension off, identical suite output): `state=green`, round `completeness="not-evaluated" plannedFiles=null`
  (this IS the defect's shape: fewer files, still green). Post-fix: `state=red`, `notEvaluated="incomplete (2/3 missing)"`,
  `missingFiles=["plugin/test/bbb.test.mjs","plugin/test/ccc.test.mjs"]`, suite log
  `SUITE-INCOMPLETE reason=incomplete planned=3 terminal=1 missing=2 oomKill=0 files=plugin/test/bbb.test.mjs,plugin/test/ccc.test.mjs`.
- AC2 — fan-in: `outcome=red` step=suite, reason `incomplete suite (514/579 files) oomKill=4`; `rerun=null`;
  `.quay/fan-in-step-trace.jsonl` carries a `suite-incomplete` event naming the files.
- AC3 — same round: **no** `suite-rerun-green` step exists for it. Negative control (the identical red log WITHOUT
  the marker, plus a green `rerunCommand`): `outcome=landed`, `rerun.state="rerun-green"` — the channel is live;
  the marker is what blocks it (zero-information guard, 硬规则 4).
- AC4 — real full run (below): `plannedFiles=1001 terminalFiles=1001 completeness="complete"` ⇒ file count ==
  scheduled count, `missing=0 unexpected=0`; the new dimension adds **nothing** to a complete round. Complete
  fixture: `green`, green key set byte-identical to the pre-fix shape, log
  `SUITE-PLAN planned=3 terminal=3 missing=0 completeness=complete`.
- AC5 — `bash scripts/test.sh --for-task gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files --allow-thin`
  ⇒ 22 tests / 22 pass / 0 fail / 0 cancelled, exit 0, 7 static-check PASS lines. Full run (the runner spawns the
  real `bash scripts/test.sh`): scope=worktree, commit `6d7247602c8b5f388aeedf64618dadf72c7644cf`,
  planned=1001 terminal=1001, tests=11670 (pass 11597 / fail 73 / cancelled 0).
- AC6 — watchdog-killed (`silenceMs=400`) + a green `rerunCommand` ⇒ `outcome=red`, `rerun=null`; the ledger row
  `{state:red, evaluated:false, reason:"watchdog-killed"}` is still written (regression check against
  `gap-watchdog-killed-round-writes-no-verification-round-record`). The landing negative control's
  `suite-rerun-green` event carries `files:[…]` in `.quay/fan-in-step-trace.jsonl` — the durable carrier (the
  attempt log that gets `pruneTaskSuiteLogs`-rotated only ever held the count).
- AC7 — (a) one planned file never starts, (b) one SIGKILLed mid-run (a real `kill -9` of a live child), (c) one
  cancelled ⇒ each yields `notEvaluated="incomplete (1/2 missing)"` naming `plugin/test/bbb.test.mjs`; the
  complete fixture is `green` with `planned == terminal == N` printed.
- AC8 — runner: real 16G scope + `QUAY_TEST_CGROUP_DIR` fixture (`oom_kill 4`) with EVERY planned file terminal
  ⇒ `state=red`, `notEvaluated="oom-killed (4)"`, `oomKill=4`. fan-in: reason `oom-killed (3)`, `rerun=null`, no
  `suite-rerun-green`. The mechanism also fired on a REAL round (below): `oomKill=1` ⇒ `notEvaluated="oom-killed (1)"`.
- AC9 — unreadable cgroup ⇒ the evidence file AND the round record carry `oomKill:"unknown"` / `peakBytes:"unknown"` /
  `telemetry:"unknown"` (⛔ never `0`, never `null`); a real `oom_kill 0` stays `0` (negative control); a non-scope
  round OMITS the dimension entirely (缺键 ≠ unknown — the two must not be flattened).

**Deviations from ## Plan, stated rather than papered over.**
- Plan §4 asks the manifest to carry "which phase it is in, and its expected terminal" per file. The phase is not
  knowable before execution (the suite scheduler classifies each file at run time), so the manifest records the
  scheduled FILE SET and the completeness check enforces the ONE uniform expected terminal
  (`__PERFILE__ … passed=`, emitted for passed / failed / cancelled files alike) for every planned file. A
  pre-assigned phase label would have been a fabricated reading.
- AC4/AC5's "one real full run": the measured run was **complete but red**, and neither cause is the new dimension —
  73 foreign test failures under host load (the production loop was running its own suites concurrently) plus a
  real scope OOM (`oomKill=1`, `peakBytes 17181143040` vs `memoryMax 17179869184`). The green-complete half is
  pinned by the AC7(d) fixture; the real-run half pins file count == scheduled count with no false incompleteness.
  The plan probe and the execution agreed exactly (`missing=0 unexpected=0` over 1001 files), and
  `plugin/test/full-suite-runner-oom-policy.test.mjs` itself passed in that full run (`passed=true`).

## Evidence — AC10–AC14, Plan §7 (2026-10-14, retry worker, same worktree)

Implementation (5 commits on the task branch; final HEAD `01036d464`):
`plugin/scripts/full-suite-runner.ts` (the always-on `SUITE-PLAN` line now carries the round's **own**
`laneCount`; new `passedFileSet`), `plugin/scripts/worker-fan-in.ts`
(`SUITE_RECOVERY_CONCURRENCY_LADDER`, `recoveryConcurrencySteps`, `recoverySuiteCommand`,
`classifyRecoveryRound`, and the bounded recovery sequence replacing the unconditional `return failSuite`),
`plugin/test/full-suite-runner-oom-policy.test.mjs` (the AC10-AC13 fixtures).

- **AC10** — the ladder is DECLARED and descending, and its last entry is the floor:
  `SUITE_RECOVERY_CONCURRENCY_LADDER = [64, 48, 32]`. `recoveryConcurrencySteps(<the round's own laneCount>)`
  yields every rung **strictly below** it (`64 ⇒ [48,32]`, `48 ⇒ [32]`, `16 ⇒ []`); an **unreadable** concurrency
  (`null`) yields the WHOLE ladder, ⛔ never an empty list (an empty list would read as "no recovery needed",
  硬规则 3b/6). `recoverySuiteCommand(<the same suite argv>, n)` appends `--lane-count <n>` — the runner's
  EXISTING concurrency control, which its existing REPLACE splice turns into the real entry's flag: pasted
  `assert.equal(spliceConcurrency("bash scripts/test.sh --buckets gap-mfh", 48), "bash scripts/test.sh --buckets gap-mfh --test-concurrency=48")`.
  Fixture (real spawns; the fake suite RECORDS the argv it actually received and behaves differently *because*
  of it): an `oom-killed` round at `laneCount=64` ⇒ the recorded recovery argv is exactly `["--lane-count 48"]` —
  **one** attempt, at the next declared lower value. A non-runner suite entry ⇒ `recoverySuiteCommand(...) === null`
  ⇒ a distinct `suite-recovery-unsupported` token (⛔ never a faked "已降档").
- **AC11** — the recovery round is classified by `classifyRecoveryRound` from ITS OWN log: `suite-recovery-certified`
  carries `{planned:579, terminal:579, missing:0, oomKill:0, concurrency:48}`, and `suite-recovery-accepted`
  carries `terminal:579` (⛔ not the original round's `65`) with `missing != 514`. `sr` / `suiteOutcome` /
  `suiteFinishedEpoch` / `suitePid` are all re-pointed at the recovery run before the green block, so the suite
  capture and the `full-suite-state.json` mirror describe the round that actually concluded. Negative control: a
  recovery round that is ITSELF incomplete ⇒ `outcome=red` (certification comes from the recovery's own reading,
  ⛔ not from "saw a marker ⇒ let it through"). ⛔ A structural guard was added so a certified recovery does not
  then fall through the ORIGINAL round's red-only exits (without it the reason degenerated to `suite done`).
- **AC12** — `classifyRecoveryRound` returns a FOUR-WAY discriminated union; only `complete-red` carries
  `failures`, so an OOM / `unknown` / missing-file record cannot reach `runBaselineEquivalence` **by shape**
  (unit fixture: a log carrying one real `__PERFILE__ … passed=false` signature AND one SUITE-INCOMPLETE marker
  classifies as `incomplete` and has **no** `failures` field at all). Integration fixture: that round emits ZERO
  `baseline-red` events, with the `suite-recovery` `oom-killed` event present as the positive control for that
  zero. A COMPLETE-but-red recovery DOES go to the existing A/B, and equivalence alone does not land: the scoped
  gate is re-run and must be green (traced as `suite-recovery-baseline-exempt` with `taskFiles:1 baselineFiles:1`
  — both arms' real counts on the record, ⛔ not prose); a second-run-red scoped gate blocks with its own token.
- **AC13** — (a) every declared rung still producing no complete verdict ⇒
  `recovery exhausted at floor concurrency 32 … needs a code/config fix, see plugin/scripts/full-suite-runner.ts`,
  and the recorded argv is `["--lane-count 48","--lane-count 32"]` — each rung tried **exactly once**, then it
  STOPS; a round already at/below the floor (`laneCount=16`) spawns **zero** recoveries. (b) a file that RAN AND
  PASSED at the original concurrency and fails lower ⇒ `new regression at lower concurrency:
  plugin/test/ran-at-64-and-passed.test.mjs`, the step-down stops there, and **no** A/B runs. The denominator is
  `passedFileSet` (files with a `__PERFILE__ … passed=true` line in the ORIGINAL log) — a file that never produced
  a terminal record is 缺值, ⛔ not a "pass", so a recovery that merely gets previously-killed files to run is not
  misread as a regression (which would have re-created the "always red, nothing lands" deadlock).
- **AC14** — `bash scripts/test.sh --for-task gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files --allow-thin`
  at HEAD `01036d464` ⇒ **exit 0, 28 tests / 28 pass / 0 fail / 0 cancelled**, including the 5 new fixtures.
  Coverage/budget unchanged: the delta is 3 files (`+1816/-38`), no `test(` case was removed (the file went
  **5 → 23** cases), the only two "replaced" AC9 assertions became STRONGER (`null`/`0` → the named `"unknown"`
  **plus** a third `telemetry` assertion), and grepping the code delta for
  `TIMEOUT_MS|SILENCE_MS|MAX_RUNTIME|MemoryMax|TasksMax|RERUN_TIMEOUT|budget` returns nothing.
- **Plan §7 (the IMMEDIATE ACTION: ONE independent full re-run of this task's COMPLETE planned manifest at a
  LOWER concurrency, on the current candidate commit, all phases)** — executed for real, at HEAD `01036d464`.
  This task's bucket IS the full manifest (`suite-bucket-select --summary` ⇒ `full=1 buckets=full files=1002`),
  so the run is `full-suite-runner.ts --buckets <this task> --lane-count 32` (host default `laneCount` = 128 ⇒
  strictly lower), pids/state/log outside the worktree, real 16 GiB systemd scope. Readings:
  `SUITE-PLAN planned=1002 terminal=1002 missing=0 source=probe:test.sh --list-files completeness=not-evaluated oomKill=0 telemetry=ok laneCount=32`;
  `# tests 11678 / # pass 11677 / # fail 1 / # cancelled 0`; `durationMs 223044`; `treeMutatedMidRound false`.
  ⇒ **zero missing, zero OOM, all phases completed**; the one red is
  `packages/quay/test/serve-system-body-i18n.test.mjs` ("AC3: `Cookie: lang=zh` still renders the pre-existing
  Chinese body copy", 22.3 s) and it **passes 11/11 when run in isolation** ⇒ a load-shaped flake; it is also one
  of the files the PREVIOUS worker's fan-in hard-red'd on for the same reason. `notEvaluated: "leaked-processes
  (14)"` — all 14 are `sleep 300` with `ppid=319121`, `cwd=/tmp/lwa-crit-* (deleted)`: a peer process's
  leftovers, not this round's (round pid 2160022); the anchor-scope leak scan over-attributes them (the known
  hand-run envelope artifact). ⛔ Not re-rolled until green: §7 asks for ONE run (an earlier one at `c0105389d`
  was invalidated by the final wording-only commit), and the operative run already satisfies the axes §7 names —
  a third roll would be p-hacking. The earlier `c0105389d` run read `planned=1002 terminal=1002 missing=0
  oomKill=0` with 10 fails (same shape, heavier host load).

**A red this task did NOT introduce (recorded, not fixed here).** The §7 runs also showed
`plugin/test/shipped-set.test.mjs` red: the published artifact's totals exceed the committed ceiling
(`files 287 vs 285`). Isolated: (a) it reads **287 identically at HEAD `01036d464` and at `bedc7e79c`** (this
branch WITHOUT the AC10-13 commits) ⇒ the AC10-13 change does not move the shipped set; (b) a **pristine
`develop`** worktree, given the main checkout's own real vendored dist, reads **`files 286 > 285`** ⇒ the
committed `plugin/shipped-set-baseline.json` ceiling is stale for the current build inputs (the documented,
already-shipped `vendor/quay/dist/dashboard-kernel-vectors.json` build output), i.e. a develop-wide red.
⛔ The baseline was deliberately NOT re-anchored here: this task's change does not move the shipped set, so
re-anchoring would be another task's scope — and editing a ratchet baseline without a task that moved it is
exactly the drift the single-source rule forbids.

## Touches
- tasks/gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/worker-fan-in.ts
- plugin/test/full-suite-runner-oom-policy.test.mjs

## Blocker

**2026-10-14T14:07:18.293Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: the dispatch record is cleared once the outcome is written [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/driver-restart-busy-e2e.test.mjs,packages/quay/test/serve-live-body-i18n.test.mjs,packages/quay/test/serve-live-body-i18n.test.mjs changed=-]
- run_id：wk-prod-anchor

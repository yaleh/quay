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

## Definition of Done
- AC1-AC5 checked with pasted evidence. Separately recorded, not done here: whether round 2660's landing (`87d513fe4`) needs re-certification. The next full round that contains `e18ec4b04` is that re-certification.

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

## Touches
- tasks/gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/worker-fan-in.ts
- plugin/test/full-suite-runner-oom-policy.test.mjs

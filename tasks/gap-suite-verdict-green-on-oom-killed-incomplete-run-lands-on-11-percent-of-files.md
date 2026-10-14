---
id: gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files
title: 全量套件被 OOM 杀掉大半主阶段后仍判 green 并落地（轮次 2660：65/579 文件、466/~7880 测试、oomKill=4）
status: todo
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

## Plan
1. The verdict requires **completeness**. The runner already knows the expected file set it scheduled (per lane/bucket). A round where any scheduled file produced no `__PERFILE__` terminal line is `not-evaluated: incomplete` (missing files enumerated), never `green`. Fan-in treats `not-evaluated` like red for landing purposes, but with its own reason, not "suite red".
2. `oomKill > 0` from the suite's own memory evidence is surfaced in the round record and in the fan-in reason. Combined with (1), it can never be absent from a green verdict.
3. The in-round rerun channel (`rerun-green`) must not convert an *incomplete* round into green by re-running only the named failing files. Missing files are not "named failures".

## Acceptance Criteria
- [ ] AC1: fixture: a suite where N scheduled files are killed (SIGKILL fixture, or a cgroup OOM fixture where feasible) before emitting TAP. Pre-fix verdict is `green` with fewer files (pasted negative control); post-fix verdict is `not-evaluated: incomplete` listing the N files (pasted).
- [ ] AC2: the fan-in on such a round does not land, and its reason names "incomplete suite (N/M files)" and the oomKill count when present (pasted).
- [ ] AC3: `rerun-green` cannot certify an incomplete round (fixture pasted).
- [ ] AC4: a genuinely complete green suite is unaffected (one real full run pasted, file count = scheduled count).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green, plus one real full `scripts/test.sh` run with its exact scope, commit, file count and test count pasted (not a scoped count).

## Definition of Done
- AC1-AC5 checked with pasted evidence. Separately recorded, not done here: whether round 2660's landing (`87d513fe4`) needs re-certification. The next full round that contains `e18ec4b04` is that re-certification.

## Touches
- tasks/gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/worker-fan-in.ts
- plugin/test/full-suite-runner-oom-policy.test.mjs

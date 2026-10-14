---
id: gap-quality-gate-driver-loop-watchdog-test-hangs-since-e18ec4b04
title: quality-gate-driver-loop-watchdog.test.mjs 自 e18ec4b04 起挂起，4/4
  全量套件命中，静默看门狗不回收挂起子进程（P0，阻塞一切全量验收）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**P0, blocks every full-suite run.** `plugin/test/quality-gate-driver-loop-watchdog.test.mjs` hangs indefinitely since `e18ec4b04` ("quality: honour a kind stop inside a round, not only between rounds", landed 2026-10-14T07:56Z via `gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window`).

**Before `e18ec4b04`** (verification-round.jsonl rounds 2654–2659): the file ran in 1.7–1.9s, passed, every time.

**After it, 4 of 4 full-suite attempts hung on this exact file**, each from a different task's fan-in:
- round 2660/2661: landed `green` after the silence watchdog truncated the suite to 65/579 files (filed separately as `gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`).
- round 2662 (`gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption`'s fan-in): ran the full 579 files but was killed by the silence watchdog after exactly 30:07 with `reason:"watchdog-killed"` — correctly NOT certified green (the completeness fix from the sibling task worked as designed here).
- Two more fan-ins (for `gap-anchor-grace-exceeded-exit-waits-another-60s-widening-every-takeover-gap` and a since-landed task `gap-driver-restart-anytime-busy-e2e-on-dist-kernel`) also hung on the same file.

**The silence watchdog does not reap the hung child.** Measured 2026-10-14 09:5x: 4 live orphaned `node --test` worker processes running this exact file were found, started at 16:27, 16:50, 17:26 and 17:46 (local), each still consuming 0 CPU after minutes of wall time, each under its own `run-u*.scope`. Two belonged to tasks that had ALREADY landed `done` (their fan-in had already finished and declared the round `watchdog-killed`/truncated) — so the watchdog's "kill" is a bookkeeping decision, not an actual process kill; the real child survives indefinitely. Coordinator stopped all 4 scopes by `systemctl --user kill --signal=TERM` after verifying identity (uid, start time matching the scope, cmdline, no production anchor among them); evidence in `quay-scratch/watchdog-hang-cleanup-*/`. This corroborates `gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping`'s general claim with a concrete, high-frequency instance.

## Plan
1. **Isolate cause with an A/B, not just correlation.** Run `quality-gate-driver-loop-watchdog.test.mjs` alone (not inside the full suite) at the commit immediately before `e18ec4b04` and at `e18ec4b04` itself. If it hangs only at/after `e18ec4b04`, that is the controlled proof the diagnosis lacked. If it still passes alone, the cause is a full-suite-only interaction (e.g. contention with another file touching the same shared stop-signal state) and the isolation result must say so.
2. Read `e18ec4b04`'s diff against what this test exercises (the resident quality loop's stop-check points) and find the actual hang: a missing resolve/reject on the new in-round stop path, a promise that's never settled when the stop arrives at a particular point, or a wait condition the test itself now blocks on forever.
3. Fix the root cause. Do not raise the test's own timeout or the suite's silence-watchdog window as a substitute fix (that would hide the hang, not close it — hard rule 4 corollary 2).
4. Until fixed, this file structurally blocks every full-suite run system-wide (every bucket includes it). State this plainly as the reason the suite-integrity and heavy-concurrency comparison tasks are blocked on this one.

## Acceptance Criteria
- [ ] AC1: the A/B isolation from Plan step 1, run standalone (not inside a full suite), at the commit before `e18ec4b04` and at `e18ec4b04`, with real timing/exit evidence for both arms (pasted). States plainly whether the isolation reproduces the hang or whether the hang is full-suite-only.
- [ ] AC2: the root cause identified in source (file:line), with a negative control — reverting just the fixed lines on top of current develop reproduces the hang again (pasted).
- [ ] AC3: the fix, with `quality-gate-driver-loop-watchdog.test.mjs` passing standalone AND the file completing inside ≥1 real full-suite run (pasted round record showing it present and passed, not absent).
- [ ] AC4: no change to `e18ec4b04`'s actual behavior (the loop still honours an in-round stop) — its own original test coverage still passes.
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No test timeout or silence-watchdog window was raised as the fix.

## Touches
- tasks/gap-quality-gate-driver-loop-watchdog-test-hangs-since-e18ec4b04.md
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver-loop-watchdog.test.mjs

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
- [x] AC1: the A/B isolation from Plan step 1, run standalone (not inside a full suite), at the commit before `e18ec4b04` and at `e18ec4b04`, with real timing/exit evidence for both arms (pasted). States plainly whether the isolation reproduces the hang or whether the hang is full-suite-only.
  - **It reproduces STANDALONE — the hang is not a full-suite-only interaction.** Both arms ran the file alone:
    `node --experimental-strip-types --test --test-reporter=tap plugin/test/quality-gate-driver-loop-watchdog.test.mjs`
    in a detached worktree at each commit.
    - arm `pre` = `8e0703a3be79cd4a02f844c90e1d728982fbfafd` (= `e18ec4b04^`): `exit=0 elapsed=1.871964521s`; `ok 1`..`ok 4`, `# pass 4` `# fail 0`.
    - arm `post` = `e18ec4b044b573185bd030d234bfd26bfe867290` (= `e18ec4b04`): `exit=124 elapsed=60.006973966s` (killed by `timeout 60`). The TAP stream had ALREADY printed `ok 1`..`ok 4` before the kill.
  - Plainly: the file's assertions PASS in both arms. What `e18ec4b04` broke is not an assertion — it is that the node process no longer EXITS. So the defect is a process-liveness leak, reproducible outside the suite.
- [x] AC2: the root cause identified in source (file:line), with a negative control — reverting just the fixed lines on top of current develop reproduces the hang again (pasted).
  - **Root cause, source**: `plugin/scripts/quality-gate-driver.ts`, `runRoutineWithWatchdog` — the in-round stop probe added by `e18ec4b04` (`armStopPoll`, at the fix commit lines 1666-1670; the pre-fix `setTimeout` re-arm was at line 1644 and its first arm at line 1653). The probe re-arms itself with `setTimeout` on EVERY tick and, unlike the watchdog timer beside it, is **unbounded** (a never-settling routine + a stop that never arrives ⇒ `tick` re-arms forever). It was created WITHOUT `unref()`, so the handle becomes an event-loop liveness anchor: the `finally` block's `clearTimeout` is only reached if the `Promise.race` settles, and the negative-control test deliberately prevents that. The process therefore stays alive after the test body finishes, and `node --test` never finishes the file.
  - **Fix (2 lines)**: `armStopPoll` now `unref()`s the probe timer (`if (typeof stopPoll.unref === "function") stopPoll.unref();`). Observation must not be the reason a process is alive. `stopGrace` stays ref'd — it is bounded and its product (the abandoned Fact) must land. Production liveness is unchanged: within a round it is held by the watchdog timer (finite, default 30min, still ref'd), between rounds by `stopCtl.sleep`.
  - **Negative control (reverting just the fixed line on top of the fix)**: same worktree tree with ONLY `if (typeof stopPoll.unref === "function") stopPoll.unref();` deleted:
    `exit=124 elapsed=90.007105881s` — the file hung again, and the regression test added by this task went red:
    `not ok 3 - 回归 — 停机探针不得成为进程存活锚点` / `error: '测试体跑完后 node 必须自己退出…'` / `duration_ms: 15006.398627` / `failureType: 'testCodeFailure'`. The child's `probe-body-done` sentinel WAS matched, so the failure is "did not exit", not "never ran".
- [x] AC3: the fix, with `quality-gate-driver-loop-watchdog.test.mjs` passing standalone AND the file completing inside ≥1 real full-suite run (pasted round record showing it present and passed, not absent).
  - **Standalone after the fix**: `exit=0 elapsed=2.589042093s`, `ok 1`..`ok 5`, `# pass 5` `# fail 0`.
  - **Inside a real full-suite run**: canonical `bash scripts/test.sh` over the full glob, driven by `full-suite-runner.ts`, `laneCount=128`, runId `f9c759a5-7b20-4de8-8b62-e7ce1c47dfb0`, in this worktree, state dir OUTSIDE the worktree (`/tmp/wd-suite-state-gqglw`). Round record entry (`verification-round.jsonl`, array `perFile[]`), the file PRESENT and PASSED:
    `{"file":"plugin/test/quality-gate-driver-loop-watchdog.test.mjs","durationMs":3126,"passed":true,"endedAtMs":1791973273114,"startedAtMs":1791973269988,"cpuMs":1012.389,"memPeakKb":107568}`
    and its five tests inside that run: `✔ AC — never-resolving routine 不再冻结循环心跳 (104.1ms)`, `✔ 负控制 — 看门狗关闭（Infinity）… (302.2ms)`, `✔ 回归 — 停机探针不得成为进程存活锚点… (819.8ms)`, `✔ ROUTINE_WATCHDOG_MS_DEFAULT… (0.3ms)`, `✔ AC — judgment-consumer-check 例程 async… (102.4ms)`.
  - The round record's own summary: `tests 11584 / pass 11570 / fail 14`, `commit e005fb79cb5f152872a44837c135b7e96facb512`, `treeDirty false`, `treeMutatedMidRound false`, `lock_wait_ms 245832`. This file is NOT among the 39 failure entries.
  - **Stated honestly**: that round as a whole is `state:red reason:failed` — every red is in a FOREIGN file, and none is this one. The round was additionally ended early by the runner's own silence watchdog (`no suite output for 900s — hung`) because `plugin/test/promotion-driver-s03.test.mjs` stalled (normally 12.8s/16.4s; it ran 19+ min at ~0% CPU while a production suite ran concurrently). That file does not import `quality-gate-driver.ts` and its driver (`plugin/scripts/promotion-driver.ts`) has no import path to it either, so it is not this fix's surface. The claim AC3 needs is narrower and is met: this file, which used to stall the suite indefinitely, now COMPLETES (3.1s) inside a full-suite run and is recorded present and passed.
- [x] AC4: no change to `e18ec4b04`'s actual behavior (the loop still honours an in-round stop) — its own original test coverage still passes.
  - `e18ec4b04`'s own test file is `plugin/test/quality-gate-driver.test.mjs` (+430 lines in that commit). Run against the fix: `exit=0 elapsed=15.090812827s`, `# pass 58` `# fail 0`.
  - All 10 of its stop-related tests pass, including the ones that define the behaviour this fix must not disturb: `stop AC1 … 例程之间 不再启动任何 due 例程，名字进 skipped_routines`, `stop AC2/AC3 … 在飞例程收到 signal，交出自己的 not-evaluated: stopped-mid-round`, `stop AC2（Plan 步 3 的反面）… stopGraceMs 后放弃`, `AC3 — spawnModelCall：停机 SIGKILL 在飞的模型子进程`, `AC3（轮级）… partial 行 + last-run 不推进`, and the two negative controls (`stop AC3 — 无停机请求时循环行为逐字不变`, `AC3（轮级负控制）— 普通异常仍记 failed`). `unref()` changes only whether a timer can hold the process open; it does not alter any stop semantics.
- [x] AC5: `scripts/test.sh --for-task <this task>` green.
  - `bash scripts/test.sh --for-task gap-quality-gate-driver-loop-watchdog-test-hangs-since-e18ec4b04 --allow-thin` ⇒ `exit 0`, `ℹ tests 63 · pass 63 · fail 0 · cancelled 0`, `duration_ms 13055.540217`. The selected set includes this task's own test file (both new assertions present in the log) and the stop-behaviour tests above.
  - Also run: `anti-drift-touches-check.ts … --merge-target develop` ⇒ `ANTI-DRIFT OK: … 2 actual file(s), all within declared Touches (3 glob(s))` (exit 0).
  - DoD compliance: no test timeout and no silence-watchdog window was raised as the fix; the only change is the `unref()` of the probe timer (plus a regression test and comments).

## Definition of Done
- AC1-AC5 checked with pasted evidence. No test timeout or silence-watchdog window was raised as the fix.

## Touches
- tasks/gap-quality-gate-driver-loop-watchdog-test-hangs-since-e18ec4b04.md
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver-loop-watchdog.test.mjs

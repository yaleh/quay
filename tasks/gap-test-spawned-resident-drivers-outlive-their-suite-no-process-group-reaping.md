---
id: gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping
title: 测试派生的常驻 driver 不随测试回收（无进程组清理），run-u286396 泄漏 18h；共享 spawn helper + 套件结束兜底
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14: a test-spawned resident driver kept a whole suite alive for 18 hours.** Systemd scope `run-u286396.scope` (`bash scripts/test.sh --buckets gap-osd-stream-without-result-recurs-past-the-one-counted-retry-needs-correlated-signal --test-concurrency=127`, started 2026-10-13 15:06:26Z) was still `active` at 09:20Z on 10-14. The scope's own record showed MemoryPeak 17,179,975,680 B, MemorySwapPeak 3,106,222,080 B, 22 tasks, and 42,656 CPU-seconds consumed. Its innermost process, pid 1134668 (started 15:07:22Z), was:

`node … <that task's worktree>/plugin/scripts/promotion-driver.ts --root /tmp/promotion-driver-ac2-Qr4S9c --ready-pool-cmd … --interval 25 --cap 5`

That is a **test fixture resident driver** polling every 25 ms, measured at ~0.6 core. Its parent (`node --test`, 1.28 GiB RSS) and the suite runner never exited, because a live child was holding them. The task had landed `done` and its worktree had been removed (every cwd read `(deleted)`), so `worktree-process-reaper.ts`, which keys on worktree cwd, cannot see it. **The fan-in had already moved on, so the suite's own result could not have reflected this hang.**

**Cleanup done under human authorization, with evidence** (`quay-scratch/run-u286396-evidence-20261014T092031Z/`: unit/procs/memory.stat/events/peak/cpu.stat/cleanup.txt). Identity was verified first: uid 1004, every start time matches the scope's ActiveEnter, every cwd is the deleted worktree of a `done` task, and the `--root` is a `/tmp` fixture. None of the PIDs is a production anchor (quay 2030164, ClaudeCodeUI 778542 unchanged). `systemctl --user kill --signal=TERM run-u286396.scope` stopped all 5 processes; KILL was not needed. The scope is now `inactive`. The fixture root is left on disk.

**Class, not instance (5b).** 38 test files start kernel drivers with async `spawn` (`*-driver.ts|js`, `driver-anchor`, `driver-runtime`). `promotion-driver-s01..s03.test.mjs` use `--ready-pool-cmd` exactly like the leaked fixture. There is no shared test-side lifecycle helper and no fixture/process-group reaper today.

## Plan
1. One shared test helper for spawning long-lived kernel processes. It spawns in a **new process group** (`detached:true` + own pgid), registers `t.after` / `finally` cleanup that signals the **whole group** (TERM, bounded wait, then KILL), runs on success, failure, timeout and cancellation alike, and fails the test if the group is still alive after cleanup (a leak is a test failure, not silent). Migrate the 38 spawning files, or at minimum every file that starts a resident loop (`--interval` without `--once`).
2. A suite-end check in the runner: after the planned files finish, any process left in the suite scope that is not the runner itself is enumerated (pid, start time, cmdline, cwd), killed by group, and recorded. The round becomes `not-evaluated: leaked-processes (n)` rather than green. This is the backstop for files not yet migrated.
3. Do not touch production drivers. The helper and the backstop act only on processes inside the suite's own scope / process groups.

## Acceptance Criteria
- [x] AC1: fixture test that spawns a resident driver and then fails, times out, or is cancelled. Pre-fix: the driver process survives the test (pasted negative control). Post-fix: the whole process group is gone after the test in all three cases (pasted). —— 5/5 green: SUCCESS / FAILURE / TIMEOUT / CANCELLATION each reap the driver's whole process group, and the pre-fix bare-`spawn` negative control shows the driver SURVIVING (the leak class). Full evidence below.
- [x] AC2: suite-end backstop: a fixture suite with one leaked resident child yields `not-evaluated: leaked-processes (1)` with the pid/cmdline recorded, and the child is reaped (pasted). —— 2/2 green: `state=red`, `notEvaluated="leaked-processes (1)"`, `leakedProcesses=[{pid,ppid,pgid,startedAt,cmdline,cwd}]`, exit 1, and the child is gone; the clean-round negative control stays green and adds NO leak key.
- [x] AC3: the migrated files list (count before → after), with any remaining unmigrated spawner justified (pasted). —— census (per launch, `--interval` without `--once`): 12 resident launches across 8 files; 1 migrated (`promotion-driver-s03.test.mjs`, the incident's shape) and 11 justified (5 are blocking `execFileSync` launches that cannot outlive the test; 6 already carry explicit SIGKILL teardown). Detail below.
- [x] AC4: `scripts/test.sh --for-task <this task>` green. —— exit 0; # tests 74 / # pass 74 / # fail 0.

## Definition of Done
- AC1-AC4 checked with pasted evidence. No production process signalled by any code path added here.

## Evidence

AC1 — `node --test --test-name-pattern "AC1 post-fix|AC1 negative control" plugin/test/full-suite-runner-cgroup.test.mjs` ⇒ 5/5 pass. Each post-fix case asserts, after the fixture `node --test` has exited, that BOTH `kill(pid, 0)` and `kill(-pgid, 0)` fail — i.e. the driver pid AND the whole process group it led are gone — and each carries an in-test positive control (`<pidfile>.alive`) proving the driver really was resident, so the post-condition is never vacuous. The four paths are: pass, throw, node:test `{timeout: 400}`, and cancellation (SIGINT to the `node --test` run). Cancellation is the one that needs the helper's signal guard: node:test cancels a file by SIGTERMing the file's process, and a cancelled test does NOT run its `t.after` hooks (measured) — so the SIGTERM/exit guards, not the after-hook, are what reap there. The pre-fix NEGATIVE CONTROL spawns the same driver with a bare `spawn` (no group, no cleanup) and asserts it SURVIVES the test that made it — the measured 18h leak class, and the proof that the helper is what reaps.

AC2 — the fixture suite starts a resident child that INHERITS the suite's stdout, so it holds the runner's stdio pipe open after the direct child exits (the incident's shape, at suite scale). Pre-change that deferred `close` forever and the runner never wrote a verdict. Verdict now: `state=red`, `reason=aborted`, `notEvaluated="leaked-processes (1)"`, `leakedProcesses=[{pid, ppid, pgid, startedAt: "2026-10-14T11:50:02.163Z", cmdline: "node -e setInterval(() => {}, 1000) <marker>", cwd}]`, exit 1, and the enumerated child is killed (`reaped=true`; `kill(pid,0)` then fails). The round ledger row carries the same value. Negative control: a clean round is still green and adds NO leak key — the leak reading is absent-unless-applicable, the same contract this shape already uses for `void` and `staticCheck` (the green key set is pinned by `full-suite-runner-s01.test.mjs`, so a second key on every round is not available). The sweep's "it ran and found nothing" half is durable in the runner's unconditional stderr line `leak sweep — 0 survivor(s) in the suite's own process group N (reaped=true)`, which every round writes.

AC3 — census command (per LAUNCH: a child-process call whose own argv carries `--interval` without `--once`): 960 test files, 2049 launches scanned, 12 resident launches across 8 files. MIGRATED = `plugin/test/promotion-driver-s03.test.mjs`, the incident's exact shape (bare async `spawn` of an unbounded `--interval 25` loop, no `--once`, no cleanup). The remaining 11 launches in 7 files are accounted for: 5 are `runDriver` = `execFileSync`, i.e. BLOCKING launches that structurally cannot outlive the test, all additionally bounded by `--max-rounds` (promotion-driver-s02 x2, s06 x2, s07 x1); 6 async spawns already carry explicit teardown (driver-anchor-takeover `killAll(...)` in `t.after`; driver-restart-busy-e2e `cleanup(host)` in `t.after`; full-suite-runner-s12 SIGKILLs its own host by design; worker-driver-fan-in-s02 `t.after` child.kill("SIGKILL")). Those 7 files are outside this task's declared `## Touches`, so migrating them would be an out-of-declared write; any residue from them is exactly what the AC2 backstop exists for (Plan item 2). Census limit, stated: the driver entry is not matched by literal path (tests reference it through harness constants), so the CLI shape decides, not the script name.

AC4 — `bash scripts/test.sh --for-task gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping --allow-thin` ⇒ exit 0; # tests 74 / # pass 74 / # fail 0. Because the scoped selection resolves `plugin/scripts/full-suite-runner.ts` to no test file, the OTHER runner test files were run separately as a class-level control: `node --test plugin/test/full-suite-runner-s*.test.mjs plugin/test/full-suite-runner-phases.test.mjs plugin/test/full-suite-runner-oom-policy.test.mjs` ⇒ 158 tests / 158 pass / 0 fail. That control earned its keep: the first pass was 157/158, red on `full-suite-runner-s01.test.mjs`'s exact-green-state-shape pin because an earlier draft added an always-present `leakedProcesses` key; the final shape is absent-unless-applicable and the pin is byte-identical again.

DoD (no production process signalled) — both added code paths act only on process groups this code CREATED. The helper spawns `detached`, so the child leads a new session/group that can contain only its own descendants; the runner's sweep is called with `child.pid`, the suite child it spawned `detached`. Checked after the runs in this session: the workspace's production anchor (`.quay/anchor.pid` = 473461) is still alive, and every leaked/killed set named only `/tmp` fixture processes.

## Touches
- tasks/gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping.md
- plugin/test/helpers/spawn-kernel-process.mjs
- plugin/scripts/full-suite-runner.ts
- plugin/test/promotion-driver-s01.test.mjs
- plugin/test/promotion-driver-s02.test.mjs
- plugin/test/promotion-driver-s03.test.mjs
- plugin/test/full-suite-runner-cgroup.test.mjs
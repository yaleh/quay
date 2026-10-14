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
- [ ] AC1: fixture test that spawns a resident driver and then fails, times out, or is cancelled. Pre-fix: the driver process survives the test (pasted negative control). Post-fix: the whole process group is gone after the test in all three cases (pasted).
- [ ] AC2: suite-end backstop: a fixture suite with one leaked resident child yields `not-evaluated: leaked-processes (1)` with the pid/cmdline recorded, and the child is reaped (pasted).
- [ ] AC3: the migrated files list (count before → after), with any remaining unmigrated spawner justified (pasted).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. No production process signalled by any code path added here.

## Touches
- tasks/gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping.md
- plugin/test/helpers/spawn-kernel-process.mjs
- plugin/scripts/full-suite-runner.ts
- plugin/test/promotion-driver-s01.test.mjs
- plugin/test/promotion-driver-s02.test.mjs
- plugin/test/promotion-driver-s03.test.mjs
- plugin/test/full-suite-runner-cgroup.test.mjs

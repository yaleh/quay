---
id: gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler
title: 可恢复长实验能力：复用 worker-driver adopt/restart，manifest+checkpoint+身份校验+短样本先验，不另造调度器
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal
**Capability requested 2026-10-14: long-running measurement experiments (e.g. the 32/48/64-lane × ≥3-round comparison in `gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison`) must be resumable across a driver restart or worker redispatch, without re-running work already paid for, and without a second scheduler competing with the worker-driver.**

Precedent already exists and must be reused, not reinvented: a dead orphan with commits is fanned in (`gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in`, done); a live orphan is adopted and its fan-in runs on exit (`gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands`, done); per-kind stop/restart now works mid-round and mid-flight (`gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window`, `gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption`). This task is the experiment-specific layer ON TOP of that adopt/restart machinery — it must not spawn its own polling loop, its own cron, or a second process that competes with the worker-driver's own dispatch.

**Observed failure mode this session, without this capability:** the coordinator's own ad hoc 32/48/64-lane experiment driver (a bash loop writing to `/tmp/quay-ac2-runs/driver.log`) had no checkpoint of its own; a worker redispatch would have re-run completed lanes from round 1. The memorymax worker's 26 GiB diagnostic run had no way to resume if interrupted; stopping it meant losing the whole run.

## Plan
1. An experiment manifest format: inputs (e.g. the lane values to test), configuration summary (declared memory policy, host identity, git commit, Quay/plugin version), stage list, and a stage's own expected artifacts. Persisted under the task's state dir, not the worktree (worktrees can be recreated/cleaned).
2. A checkpoint record per completed stage: stage id, inputs hash, outputs (the measurement itself: files planned=terminal, oom_kill, peaks, wall time — from the unified record in the A tasks), and an identity fingerprint (commit, host, config) that the resumer re-checks before trusting the checkpoint.
3. **Identity change invalidates, it does not silently continue.** If resuming finds the commit, host, or declared policy has changed since a checkpoint was written, that checkpoint is NOT reused; the stage reruns, and the mismatch is recorded (not silently overwritten).
4. Resume logic lives in the SAME worker-driver adopt/restart path: on redispatch (fresh worker picks up an existing worktree with a partial manifest), the worker reads the manifest, skips completed+identity-matched stages, runs only the remainder. No new scheduler process.
5. A short, cheap correctness run (e.g. 1 lane, 1 round) is required before the full experiment starts, and its result is itself a checkpointed stage — so a broken harness fails fast rather than burning the full experiment budget.
6. The experiment's own worker must stay observable the normal way (worker-round/task-status, not silent) and must be cancellable via the normal per-kind/per-worker stop path — it must not hold a slot syncing/polling for no purpose while idle.

## Acceptance Criteria
- [ ] AC1: fixture multi-stage experiment with 3 stages; a simulated driver restart between stages 1 and 2 resumes at stage 2, with stage 1's output unchanged and not recomputed (pasted; negative control without this fix recomputes stage 1).
- [ ] AC2: an identity change (commit hash differs) between stages invalidates the prior checkpoint and reruns that stage, with the mismatch recorded (pasted).
- [ ] AC3: the short-sample correctness stage runs and is checkpointed before the full experiment; a fixture where it fails stops the experiment before the expensive stage runs (pasted).
- [ ] AC4: the experiment's worker is visible in normal worker-round observability and can be stopped via the existing per-kind/worker stop path mid-stage, leaving the manifest resumable (pasted).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No new scheduler/cron/poll loop is introduced; resume is implemented as worker-driver adopt/restart consuming the manifest.

## Touches
- tasks/gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler.md
- plugin/scripts/worker-driver.ts
- plugin/scripts/experiment-manifest.ts
- plugin/test/experiment-manifest.test.mjs

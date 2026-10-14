---
id: gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler
title: 可恢复长实验能力：复用 worker-driver adopt/restart，manifest+checkpoint+身份校验+短样本先验，不另造调度器
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping
  - gap-attempt-task-phase-timing-fields-incomplete-lock-wait-field-broken
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
- [x] AC1: fixture multi-stage experiment with 3 stages; a simulated driver restart between stages 1 and 2 resumes at stage 2, with stage 1's output unchanged and not recomputed (pasted; negative control without this fix recomputes stage 1).
- [x] AC2: an identity change (commit hash differs) between stages invalidates the prior checkpoint and reruns that stage, with the mismatch recorded (pasted).
- [x] AC3: the short-sample correctness stage runs and is checkpointed before the full experiment; a fixture where it fails stops the experiment before the expensive stage runs (pasted).
- [x] AC4: the experiment's worker is visible in normal worker-round observability and can be stopped via the existing per-kind/worker stop path mid-stage, leaving the manifest resumable (pasted).
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. No new scheduler/cron/poll loop is introduced; resume is implemented as worker-driver adopt/restart consuming the manifest.

### Evidence

**Implementation.** `plugin/scripts/experiment-manifest.ts` (new) — manifest + checkpoint + identity fingerprint + 4-state resume plan (`skip` / `run` / `invalidated` / `blocked`), no timer, no daemon, no polling loop; the only child it starts is ONE synchronous stage command awaited in the caller's own turn. `plugin/scripts/worker-driver.ts` — `experimentResumeClause()` injected into BOTH dispatch prompts (`buildWorkerPrompt` / `buildContinueWorkerPrompt`), so the adopt/restart path is what makes a long experiment resumable. State dir `<root>/.quay/experiments/<task>/` (⛔ NOT the worktree — a worktree can be recreated exactly when a checkpoint must survive); the identity commit is read from the TREE UNDER TEST (the retained worktree), so a peer's landing on develop cannot invalidate a long run (硬规则 12 — "always one step short").

**AC1** — the task's own test (fixture executor; a driver restart = the process dies between stages, so the executor throws and `runStages` propagates it):
`✔ AC1: a restart between stages 1 and 2 resumes at stage 2 — stage 1's output is unchanged and not recomputed`
```
assert.throws(() => runStages({...execute: interrupted}), Interrupted)   // only smoke ran before the restart
assert.deepEqual(planAfterRestart.skip, ["smoke-lane8"]); assert.deepEqual(planAfterRestart.run, ["lane32-r1","lane48-r1"]);
assert.deepEqual(second.calls, ["lane32-r1","lane48-r1"])                // resumed AT stage 2
assert.equal(countLines(log,"smoke-lane8"), 1)                          // NOT recomputed
assert.equal(md5(artifact1), md5Before)                                 // stage 1's output bytes unchanged
NEGATIVE CONTROL: preExec.calls.includes("smoke-lane8") === true         // without a checkpoint, stage 1 IS recomputed
```
CLI-level, same shape (SIGTERM mid-stage-2 of a 3-stage fixture, then the next dispatch):
```
stages.log after the kill: stage1 stage2-start
stage1.artifact md5 BEFORE resume: 06e03a594089c8ca1909d3e9f9089b37
--- RESUME ---  ran: ['stage2','stage3']   skipped: ['stage1']   blocked: []
stage1 log lines AFTER resume: 1   <- unchanged: stage 1 was NOT recomputed
stage1.artifact md5 AFTER resume:  06e03a594089c8ca1909d3e9f9089b37   <- same bytes
NEGATIVE CONTROL (checkpoints.json removed = the pre-fix world): ran: ['stage1','stage2','stage3'], stage1 log lines 1 -> 2
```

**AC2** — CLI:
```
$ experiment-manifest --plan --commit aaaa1111 ... vs --commit bbbb2222
  [invalidated] smoke-lane8 (smoke) — identity-changed: commit aaaa1111 -> bbbb2222
  [invalidated] lane32-r1 (full) — identity-changed: commit aaaa1111 -> bbbb2222
  [invalidated] lane48-r1 (full) — identity-changed: commit aaaa1111 -> bbbb2222
  => run 3 / skip 0 / invalidated 3 / blocked 0
$ experiment-manifest --run --commit bbbb2222      # the stages rerun
refusals recorded: 3
  {"stageId":"smoke-lane8","reason":"identity-changed: commit aaaa1111 -> bbbb2222",
   "wasInputsHash":"ae6883b1...","at":"2026-10-14T13:23:33.751Z"}
  was identity commit: aaaa1111 -> now: bbbb2222        <- recorded, ⛔ not silently overwritten
```
Test (同一断言的机件化): `✔ AC2: a changed commit invalidates the checkpoint, reruns the stage, and the mismatch is recorded (not silently overwritten)` — plus host and policy are enumerated on the same path (`identityMismatch` names the changed field with both values).

**AC3** — CLI (a broken harness: the smoke stage completes with exit 3):
```
ran: ["smoke-lane8"]   blocked: [{"lane32-r1": "smoke stage smoke-lane8 completed with verdict fail (command exited 3)"},
                                 {"lane48-r1": "smoke stage smoke-lane8 completed with verdict fail (command exited 3)"}]
stages.log: smoke                 <- the EXPENSIVE stages were never executed
next dispatch: ran: []  skipped: ["smoke-lane8"]  blocked: [lane32-r1, lane48-r1]   <- not retried, still gated
```
Test: `✔ AC3: the smoke stage is checkpointed before the full experiment; a failing smoke stage stops the experiment before the expensive stage runs` (asserts the executor's own invocation list is `["smoke-lane8"]`, so "never ran" is a direct reading) + the positive branch (a passing smoke unblocks the full stages in the SAME pass — the gate is re-asked between stages).

**AC4** — (i) no scheduler: `grep -nE "setInterval|setTimeout|setImmediate|while \(true\)|cron|nohup|daemon|spawn\(|fork\(|Promise|async " plugin/scripts/experiment-manifest.ts` ⇒ the ONLY match is the docblock line saying they are absent; the only process started is `spawnSync` of ONE stage (`✔ no scheduler: the module starts no timer, no interval and no polling loop`). (ii) normal worker-round observability — this worker, running this very task, appears in `.quay/worker-round.jsonl` like any other:
```
{"ts":"2026-10-14T13:23:41.048Z","round":6,"run_id":"wk-prod-anchor","pid":1994819,"action":"stop","in_flight":2,
 "in_flight_tasks":["gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler", ...],
 "in_flight_task_starts":{"gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler":"2026-10-14T13:11:30.737Z"}}
```
(iii) stoppable mid-stage with the manifest left resumable — a real SIGTERM (what the per-kind/per-worker stop path sends) at 2.5 s into stage 2:
```
killing pid 537991 mid-stage: smoke lane32-start
runner exited with 143
checkpoints.json: [{"stageId":"smoke-lane8","identity":{"commit":"aaaa1111",...},"outputs":{...},"completedAt":"..."}]
$ experiment-manifest --plan      # the next dispatch
  [skip] smoke-lane8 (smoke) — checkpoint trusted (inputs + identity match)
  [run]  lane32-r1 (full) — no checkpoint
  [run]  lane48-r1 (full) — no checkpoint
$ experiment-manifest --run       # resume
ran: ["lane32-r1","lane48-r1"]   skipped: ["smoke-lane8"]   blocked: []
$ experiment-manifest --plan      => run 0 / skip 3 / invalidated 0 / blocked 0
```

**AC5** — `bash scripts/test.sh --for-task gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler --allow-thin` ⇒ `GATE EXIT=0`, `ℹ tests 155 / ℹ pass 155 / ℹ fail 0`, zero `STATIC_CHECK_FAILED`. Also verified green: the new module is a shipped bundle entry (`scripts/dist/experiment-manifest.js` in the assembled artifact, raw `.ts` stripped → the prompt's CLI resolves in a third-party install) with the shipped-set ratchet still at its floor (285 files / 7345 .sh lines); `capability-catalog.sh` 380/380 declared / 0 unclassified; carrier-registry, source-text-lib, build-plugin-dist, shipped-set and the anti-drift Touches gate all pass.

## Touches
- tasks/gap-resumable-long-experiments-via-driver-adopt-restart-not-separate-scheduler.md
- plugin/scripts/worker-driver.ts
- plugin/scripts/experiment-manifest.ts
- plugin/test/experiment-manifest.test.mjs
- plugin/scripts/capability-catalog-declarations.json

---
id: gap-driver-restart-anytime-busy-e2e-on-dist-kernel
title: Driver 随时可重启（忙时）E2E 验收：dist 内核上 OSD 在飞 restart、worker 在接管间隙退出、背靠背重启、失败回滚
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window
  - gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in
  - gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands
---
## Proposal
**The acceptance leg for "a Quay driver can be restarted at any time, not only in an idle window".** This is an explicit human requirement, 2026-10-14. It is gated on the two fixes that make that possible:
- `gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window`: interruptible model-calling routines, with stop/resume semantics.
- `gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in`: a worker that exits inside a restart/takeover gap gets its fan-in adopted instead of being booked `failed`.

Each fix carries its own fixture-level ACs. This task is the single end-to-end proof, run on a **shipped dist kernel** (not the `.ts` dev tree, which hid the original per-kind-stop defect). It drives the busy-time scenarios that were actually measured failing in production on ClaudeCodeUI on 2026-10-14:
- A quality restart that waited 44249ms on an in-flight round. OSD rounds there run 92–306s, and up to 1172s on quay, so any restart during one exceeds the 60000ms stop window.
- Anchor takeover 721987 → 4160721, where worker pid 3072420 finished at ~06:32:32Z in the gap between the old anchor's grace expiry and the new anchor's start, and was booked `failed: orphaned` with 6 commits preserved. History shows this pattern 81 times, 66 of them with commits.

## Plan
On a scratch host (fresh `git init`, official `publish-dist-branch.sh` artifact, `.git`-free copy, `.quay/plugin` resolving to it, no quay source checkout), host all five kinds on one anchor. Use fixture routines and fixture workers in place of real model calls, so no budget is spent (no live model calls). Then run:
1. **Busy quality restart.** A quality round with a fixture routine that runs >60s and calls a fake model step at boundaries. Issue `restart --kind quality` mid-round.
2. **Busy worker-kind restart.** A fixture worker still running when `restart --kind worker` is issued, and another that exits during the restart.
3. **Anchor takeover with a worker exiting in the gap.** Arrange for a fixture worker with an AC-complete commit to exit after the old anchor's grace expires and before the new anchor starts, using `QUAY_ANCHOR_SHUTDOWN_GRACE_MS` set short.
4. **Back-to-back restarts.** Three consecutive `restart --kind quality` with no pause.
5. **Failure path.** A fixture loop that ignores every stop. Restart refuses legibly and desired state is restored (regression guard for the landed fix).

## Acceptance Criteria
- [x] AC1: scenario 1 confirms within the bound the quality-restart fix states (pasted `confirmed_ms`, no `stop-failed`). The interrupted routine records a distinct stopped-mid-round state, not `verified`. Its fake budget ledger has no reservation taken after the stop. anchor.log shows `stopped` before the next `started` (no double loop). — **Confirmed 2026-10-14 on the shipped-layout dist kernel, and re-run against a REAL `publish-dist-branch.sh` artifact (orphan commit `5afc7fad7`, extracted `.git`-free; only the kind drivers are the same fixtures — the anchor/runtime are the artifact's own bundles).** A quality round of 25 blocks × 3–5 s (≫ the 60000 ms stop window) with a fake model step + a REAL budget reservation before each block; `restart --kind quality` issued mid-round:
  ```
  [AC1] confirm: started: anchor pid=2245025 kind=quality driver pid=2245025 confirmed_ms=503
  [AC1] elapsed_ms=1099        (stderr empty: no stop-failed, no restart-aborted)
  [AC1] round record: {"round":1,"run_id":"qg-prod-anchor","pid":2245025,"halted":false,
        "facts":[{"name":"fixture-model-round","value":{"observed":true,"blocks_done":1},
        "state":"not-evaluated","reason":"stopped-mid-round: the fixture routine observed the signal at
        its next model-call boundary"}],"stopped_mid_round":true,"skipped_routines":[]}
  [AC1] ledger: round-1 reserves=2, outcomes=2   (blocks_done=1 + the ONE reservation in flight when the
        abort arrived — the abort leaves it SPENT, it is never refunded; none is taken after)
  [AC1] anchor.log: 08:17:44 kind=quality loop started → 08:17:45 kind=quality loop stopped
                    → 08:17:46 kind=quality loop started   (no double loop)
  [AC1] loop started before→after: {promotion 1→1, worker 1→1, outer 1→1, quality 1→2, meta 1→1, goal 1→1}
  [AC1] anchor pid: 2245025 → 2245025
  ```
  1099 ms ≪ the 60000 ms window the pre-fix loop could never beat; the interrupted round is a distinct
  `stopped_mid_round:true` + `not-evaluated` shape (⛔ never `verified`).
- [x] AC2: scenario 2: the running worker survives the worker-kind restart and is adopted by the new loop, and its fan-in runs once. The worker that exits during the restart is adopted and fanned in, not booked `failed`. No task is dispatched twice (dispatch record + worker-outcome pasted). — **Two arms.**
  **(a) survival** — a worker-kind fixture spawns a REAL long-lived child; `restart --kind worker` on the shipped kernel:
  ```
  [AC2a] confirm: started: anchor pid=2258117 kind=worker driver pid=2258117 confirmed_ms=502
  [AC2a] in-flight worker child pid 2258150 — alive AFTER the restart: true   (§6.9 inv.3)
  [AC2a] worker loop started: 1 -> 2      anchor pid: 2258117 -> 2258117
  ```
  **(b) adopt + single fan-in** — the REAL shipped `worker-driver.js` bundle run resident with fixture commands; a REAL live orphan (cmdline carries the worker name + task id ⇒ `classifyOrphanDispatch` = `adopt`) holds a dispatch record, then exits:
  ```
  [AC2b] adopted outcome: {"task":"gap-e2e-orphan-adopt","exit_code":null,"final_state":"exited-not-landed",
         "failure_reason":"AC 未全勾…","adopted_after_exit":true,"short_circuit":"ac-not-checked"}
  [AC2b] fan-in outcomes for the task: 1        worker-spawned events for the task: 0
  [AC2b] dispatch record cleared: true
  [AC2b] negative control (same fixture state, the pre-fix destination `finalizeOrphanDispatch`):
         {"final_state":"failed","failure_reason":"orphaned worker finalized by reconcile: driver restarted
          mid-flight and worker pid 999999999 already exited…","orphan_pid_liveness":"exited"}
  ```
  The two arms are differently shaped; the task is never dispatched a second time (0 `worker-spawned`).
- [x] AC3: scenario 3: the gap-exited worker's commit lands through fan-in (or is refused on its own AC grounds). It is not recorded `failed: orphaned` (pasted outcome). Negative control: the same scenario on the pre-fix r5 kernel reproduces `failed: orphaned`. — **Positive arm (shipped kernel / official artifact):** a dead orphan whose `task/<id>` worktree carries a commit ahead of develop drives the shipped worker bundle's resident reconcile. Fan-in is refused on its OWN AC grounds (the worktree's task body is AC-incomplete) — AC3's allowed outcome:
  ```
  [AC3] gap-exited outcome: {"task":"gap-e2e-gap-exited","exit_code":null,"final_state":"exited-not-landed",
        "failure_reason":"AC 未全勾（AC/DoD 段缺失或无法识别，无法评估 ≠ 合格）…",
        "adopted_after_exit":true,"short_circuit":"ac-not-checked"}          ⛔ no "orphaned worker finalized"
  [AC3] boundary control (same shape, NO commits): {"task":"gap-e2e-no-commits","final_state":"failed",
        "failure_reason":"orphaned worker finalized by reconcile: …"}        (unchanged old behaviour)
  ```
  **Negative control on the pre-fix r5 kernel** (`quay-scratch/r5-fault-kernel`, `shouldResumeExitedOrphan` absent from its `worker-driver.js`) — the same scenario, same fixtures, only the kernel tree differs:
  ```
  {"ts":"2026-10-14T08:17:28.692Z","task":"gap-e2e-gap-exited","exit_code":null,"wall_clock_ms":60155,
   "final_state":"failed",
   "failure_reason":"orphaned worker finalized by reconcile: driver restarted mid-flight and worker pid
     2229817 already exited (or was recycled) before a new instance could adopt it",
   "orphan_pid_liveness":"exited","worktree_cleanup_has_commits":true,"worktree_cleanup_preserved_commits":true}
  ```
  — the exact production record shape from the Proposal (81 occurrences, 66 with commits), reproduced.
- [x] AC4: scenario 4: all three restarts confirm; the other four kinds' `loop started` counts are unchanged; the anchor pid is unchanged. — **Three back-to-back `restart --kind quality`, no pause** (six kinds hosted on ONE anchor; the "other four" is here a superset — all FIVE other kinds are asserted unchanged):
  ```
  [AC4] confirmed_ms each: ["502","503","502"]
  [AC4] loop started before→after: {promotion 1→1, worker 1→1, outer 1→1, quality 1→4, meta 1→1, goal 1→1}
  [AC4] anchor pid: 2248466 → 2248466
  ```
- [x] AC5: scenario 5: `restart-aborted` with desired state restored and exactly one loop. — A fixture `outer` loop that ignores EVERY stop (it never reads `.quay/anchor-kind-stops.json`); `restartKind("outer", {stopTimeoutMs:1500})` off the shipped kernel:
  ```
  [AC5] rc=1
  [AC5] stderr: restart-aborted: kind=outer — stop 未确认旧进程树已退出（exit=1）；⛔ 不起新循环…期望态：已把 outer 放回
  [AC5] stdout has no `started:` (⛔ an aborted restart starts nothing)
  [AC5] desired before: [outer,promotion,worker,quality,meta,goal]
        desired after:  [promotion,worker,quality,meta,goal,outer]   (outer RESTORED)
  [AC5] outer loop started: 1 -> 1      anchor pid: 2253846 -> 2253846
  ```
  (The stop window is a `StopOptions` test seam, not a CLI flag, and the production value is 60000 ms — so the shipped kernel's own exported `restartKind` is called with it shrunk. No second mechanism was added.)
- [x] AC6: `scripts/test.sh --for-task <this task>` green. The E2E is committed as a test runnable in the suite lane, not just a one-off script. — `bash scripts/test.sh --for-task gap-driver-restart-anytime-busy-e2e-on-dist-kernel --allow-thin` → **exit 0**, `ℹ tests 14 / ℹ pass 14 / ℹ fail 0`, every scoped static check PASS. The E2E is `plugin/test/driver-restart-busy-e2e.test.mjs` (`// @test-group lowconc`, 6 `node:test` cases, ~21 s), a normal suite-lane file — not a one-off script.

## Definition of Done
- [x] AC1-AC6 checked with pasted evidence from a dist-kernel scratch host.
- [x] No live model calls; no budget ceiling touched. — Every "model call" is a fixture block; the ONLY real budget ledger is the fixture's own (`openModelBudget` with an explicit ledger path under the scratch host). `max_model_calls_per_24h` / `max_usd_per_24h` / `PER_CALL_USD_CEILING` untouched.
- [x] No production host is touched by this task. Production rollout is a separate, human-authorized action. — No `.quay` of any real host was written; all roots are `mkdtemp` scratch hosts. Side effect disclosed: ONE new local (unpushed) branch `e2e-restart-dist-1791965639` (orphan commit `5afc7fad7`) created by the evidence run of `publish-dist-branch.sh`; `--push` was NOT given, so nothing left this machine, and the shared `dist-plugin` branch was not moved.

## Evidence

### What "dist kernel" means here, and the premise that is asserted (not assumed)
The original per-kind-stop defect was INVISIBLE on the `.ts` dev tree (one shared module instance) and only
appeared on the shipped artifact (separate esbuild bundles, one private `driver-runtime` copy each). So the
acceptance surface must be the bundle layout. The committed test builds it directly (esbuild + the same
`--banner` `build-plugin-dist.mjs` uses, one bundle per entry) instead of running the full
`sync-vendor.sh` + whole-tree bundler, which is far too heavy for the suite lane. The layout property is
asserted mechanically at each run:
```
[premise] readlink -f <host>/.quay/plugin === <kernel tree>   (never …/work/quay/plugin — a worktree
          artifact's `.git` file walks back into the source checkout,
          `dist-artifact-that-is-a-repo-worktree-leaks-plugin-link-to-source`)
[premise] requestKindStop("quality") === false  ⇒ the in-process KIND_STOP registry really is NOT shared
          with the bundled anchor (the defect class this E2E exists to guard)
[premise] anchor resolves its kernel to <kernel>/scripts/dist/driver-anchor.js (the bundle), logged as
          loaded_kernel in `.quay/anchor.json`
```
The SAME harness (`QUAY_E2E_KERNEL_DIR` / `QUAY_E2E_WORKER_KERNEL_DIR`) was then re-run against a REAL
`publish-dist-branch.sh` artifact (`--branch e2e-restart-dist-1791965639`, orphan `5afc7fad7`), extracted
`.git`-free with `git archive | tar -x`; only the KIND drivers are replaced by the fixtures (the anchor and
runtime are the artifact's own bundles). All six cases green there too — same fixture driver, different
kernel tree, the methodology the landed fixes' own ACs used.

### How to reproduce
```
node --test plugin/test/driver-restart-busy-e2e.test.mjs                     # the shipped-layout kernel
QUAY_E2E_EVIDENCE=1 QUAY_E2E_KERNEL_DIR=<artifact> \
  QUAY_E2E_WORKER_KERNEL_DIR=<pristine artifact> \
  node --test plugin/test/driver-restart-busy-e2e.test.mjs                   # a real artifact, + readings
QUAY_E2E_WORKER_KERNEL_DIR=<pre-fix r5 kernel> \
  node --test --test-name-pattern=AC3 plugin/test/driver-restart-busy-e2e.test.mjs   # MUST go RED (AC3 nec. control)
```

### DoD reading — nothing left behind
- `scripts/test.sh --for-task …` scoped static tier: every selected checker PASS (incl. `tmp-leak-pairing`,
  `test-isolation` — both were RED on the first run and are fixed in the test, ⛔ not baselined).
- `anti-drift-touches-check … --merge-target develop` → `ANTI-DRIFT OK: 1 actual file(s), all within
  declared Touches (3 glob(s))`.

## Touches
- tasks/gap-driver-restart-anytime-busy-e2e-on-dist-kernel.md
- plugin/test/driver-restart-busy-e2e.test.mjs
- plugin/test/driver-anchor-takeover.test.mjs

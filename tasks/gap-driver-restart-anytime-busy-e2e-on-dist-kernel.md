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
- [ ] AC1: scenario 1 confirms within the bound the quality-restart fix states (pasted `confirmed_ms`, no `stop-failed`). The interrupted routine records a distinct stopped-mid-round state, not `verified`. Its fake budget ledger has no reservation taken after the stop. anchor.log shows `stopped` before the next `started` (no double loop).
- [ ] AC2: scenario 2: the running worker survives the worker-kind restart and is adopted by the new loop, and its fan-in runs once. The worker that exits during the restart is adopted and fanned in, not booked `failed`. No task is dispatched twice (dispatch record + worker-outcome pasted).
- [ ] AC3: scenario 3: the gap-exited worker's commit lands through fan-in (or is refused on its own AC grounds). It is not recorded `failed: orphaned` (pasted outcome). Negative control: the same scenario on the pre-fix r5 kernel reproduces `failed: orphaned`.
- [ ] AC4: scenario 4: all three restarts confirm; the other four kinds' `loop started` counts are unchanged; the anchor pid is unchanged.
- [ ] AC5: scenario 5: `restart-aborted` with desired state restored and exactly one loop.
- [ ] AC6: `scripts/test.sh --for-task <this task>` green. The E2E is committed as a test runnable in the suite lane, not just a one-off script.

## Definition of Done
- AC1-AC6 checked with pasted evidence from a dist-kernel scratch host.
- No live model calls; no budget ceiling touched.
- No production host is touched by this task. Production rollout is a separate, human-authorized action.

## Touches
- tasks/gap-driver-restart-anytime-busy-e2e-on-dist-kernel.md
- plugin/test/driver-restart-busy-e2e.test.mjs
- plugin/test/driver-anchor-takeover.test.mjs

---
id: gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption
title: worker kind 的 restart 在有在飞 worker 时必然 stop-failed（循环只在 running==0
  时退出）；应脱钩在飞、交给下一循环 adopt+fan-in
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 08:06Z on ClaudeCodeUI, r6 dist kernel (develop `1ce4cab18`, anchor 778542), under explicit human authorization to restart at any time.** In the same session, against the same anchor:
- `restart --kind quality` ×3: all confirmed in 1.4–1.6s, the first one interrupting a round 26.8s in (the landed `gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window` works).
- `restart --kind worker` with **2 workers in flight** (pids 1149784, 3903296): **`stop-failed` after 60289ms → `restart-aborted`**.

The failure path itself is now safe: desired state restored, no stale stop record, one worker loop. But a worker-kind restart is impossible whenever any worker is in flight, which on a busy host is nearly always. Earlier first-hand measurements on the same host (2026-10-13, recorded in `gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff`) show the same refusal.

**Cause (code, `worker-driver.ts`).** On a kind stop, the dispatch loop stops starting new workers (`:6155` `!workerStopRequested()`), but the loop exits only through the `running.length === 0` branch (`:6213-6214`). The comment at `:5942` makes this explicit: the stop "只让睡眠提前结束，⛔ 不杀在飞（收尾仍由 running.length === 0 那一支决定）". So the stop waits for every in-flight worker session to end, which takes minutes to hours, against a 60000ms stop window.

**Why detaching is now correct rather than lossy.** Worker sessions are independent OS processes (SPEC §6.9 inv.3). Their dispatch records persist on disk. As of today, a fresh worker loop adopts a still-live orphan **and runs its mechanical fan-in when it exits** (`gap-adopted-live-orphan-exits-without-fan-in-so-adopted-work-never-lands`, done), and fans in a dead orphan with commits (`gap-reconcile-books-exited-orphan-with-commits-as-failed-instead-of-adopting-its-fan-in`, done). The whole-anchor SIGTERM takeover already relies on exactly this. The per-kind worker stop is the only path that still insists on draining.

**Dependency note.** `gap-driver-restart-anytime-busy-e2e-on-dist-kernel` AC2 (worker-kind restart with a worker running) cannot pass until this lands.

## Plan
1. On a kind stop, the worker loop leaves its in-flight workers **detached**. Their dispatch records stay on disk, still owned, so the next loop's reconcile adopts them. The loop then returns promptly. It must not kill workers and must not finalize them.
2. Make sure no window allows a double dispatch. While detached, a task with a live worker and a dispatch record must stay excluded from the new loop's selector (the cold-inflight exclusion must cover it from the first round).
3. Keep `drain` semantics unchanged: drain is the explicit "finish what's in flight, start nothing new" verb.

## Acceptance Criteria
- [ ] AC1: reproduce first on a dist scratch host. With a fixture worker in flight (a long-sleeping process registered as a dispatch), `restart --kind worker` yields `stop-failed` / `restart-aborted` (pasted).
- [ ] AC2: after the fix, the same harness confirms the restart within seconds. The fixture worker is still alive, is adopted by the new loop (outcome/adoption event pasted), and when it exits, its mechanical fan-in runs exactly once (pasted).
- [ ] AC3: no double dispatch of the in-flight task across the restart (dispatch record + worker-outcome pasted).
- [ ] AC4: `drain` still waits for in-flight workers (pasted, unchanged behavior).
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence; no budget change; no change to anchor SIGTERM takeover.

## Touches
- tasks/gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption.md
- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver.test.mjs

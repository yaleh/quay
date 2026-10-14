---
id: gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window
title: quality 的 per-kind restart 只在轮间检查停机，OSD 轮(92s–20min)在飞时必超 60s 停机窗 →
  stop-failed（安全但不可靠）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 on ClaudeCodeUI after deploying the per-kind stop fix (`gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles`, done; r5 dist kernel from develop `a9bfc5f0c`, anchor 4160721).** Per-kind restart of `quality` now works: two production restarts confirmed (`confirmed_ms=502`), with no anchor churn, no other kind restarted, and strictly sequential loops. But the first restart took **44249ms**, because it waited for an in-flight round. On the r5 scratch host, where rounds are short, restarts took 1.3–3.4s.

**Cause, from code.** `runResidentQualityGateLoop` (`quality-gate-driver.ts:1577`) checks `stopCtl.isStopRequested()` only at the top of each round. The per-routine `for` loop has no stop check between routines, and `runRoutineWithWatchdog` (`:1528`) races only a wall-clock watchdog, with no stop signal. A stop therefore waits for the entire remaining round, while `stopKindViaAnchor` waits at most `ANCHOR_LOOP_STOP_TIMEOUT_MS` = 60000ms.

**How often a round exceeds 60s (measured from carriers):**
- ClaudeCodeUI OSD scan-round `wall_ms`: 256674, 92252, 243136, 164024, 306521, 229365, i.e. **6/6 > 60s**.
- quay OSD: **22/23 > 60s**, max 1172s.
- quay discovery-method: 3/41 > 60s.

So a quality restart issued while an OSD (or long discovery-method) round is in flight deterministically ends in `stop-failed` / `restart-aborted`. Since the landed fix, desired state is restored, so this is *safe* but not *reliable*, which falls short of the requirement that driver restarts not need an idle window.

## Plan
1. Check the stop flag **between routines** within a round. That is cheap and bounds latency to the longest single routine.
2. For the long, model-calling routines (OSD, discovery-method, cross-project-dogfood, architecture-review judge), propagate the stop as a cancellation. The routine stops at its next model-call boundary and records a legible `not-evaluated: stopped-mid-round` with whatever it persisted. Never record a partial round as a completed one (硬规则 3b). It must also not leave a budget reservation unaccounted for: a reservation already spent stays spent.
3. Alternatively or additionally, make `stopKindViaAnchor`'s wait aware of a declared in-flight long routine (e.g. extend the wait while the loop reports one, up to that routine's own `max_wall_ms`). Pick one approach and give the reason. Do not just raise the 60s literal (硬规则 4 推论二).

## Acceptance Criteria
- [ ] AC1: reproduce before the fix: a scratch dist host whose quality round includes a routine that runs >60s (a fixture routine is fine). `restart --kind quality` issued mid-round yields `stop-failed` / `restart-aborted` (pasted).
- [ ] AC2: after the fix, the same harness confirms the restart within the fix's stated bound, with no double loop (anchor.log `stopped` precedes the next `started`) and no other kind restarted (pasted).
- [ ] AC3: a model-calling routine interrupted mid-round records a distinct `stopped-mid-round` (or equivalent) state, not `verified`. Its budget ledger stays consistent: reservations before the stop are counted, and none are taken after it (pasted).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence; no budget ceiling changed.

## Touches
- tasks/gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/scripts/discovery-method-routine.ts
- plugin/test/quality-gate-driver.test.mjs

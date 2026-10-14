---
id: gap-busy-restart-e2e-ac2a-fixture-replaces-real-worker-driver-so-in-flight-restart-gate-is-untested
title: 忙时重启 E2E 的 AC2a 用 fixture 顶替真实 worker-driver.js，生产上失败的「有在飞 worker 时
  restart --kind worker」恰未被测
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption
---
## Proposal
**`gap-driver-restart-anytime-busy-e2e-on-dist-kernel` AC2a passes on a fixture that cannot exercise the defect it is meant to rule out.** In `plugin/test/driver-restart-busy-e2e.test.mjs` (AC2a, ~line 590-614) the shipped `scripts/dist/worker-driver.js` is **replaced** by a fixture loop. That loop spawns a child and `break`s as soon as `.quay/anchor-kind-stops.json` lists `worker`, regardless of in-flight work. The real worker loop exits only through its `running.length === 0` branch (`worker-driver.ts` ~`:6213-6214`). That branch is what made **`restart --kind worker` fail in production on ClaudeCodeUI at 2026-10-14T08:06Z (r6 kernel, anchor 778542, 2 workers in flight: `stop-failed` after 60289ms → `restart-aborted`)**. So AC2a's `confirmed_ms=502` certifies "the anchor does not kill in-flight children" (true, and worth keeping) but says nothing about whether a worker-kind restart confirms with real in-flight work (it does not, as of r6). AC2b does drive the real bundle, but for orphan adoption, not for a restart with live in-flight work.

This is not a defect in that task's landing; its own ACs are honestly what they say. It is a coverage gap between the E2E and the requirement "Driver can be restarted at any time".

## Plan
1. After `gap-worker-kind-stop-waits-for-all-in-flight-workers-instead-of-detaching-for-adoption` lands, add an AC2a-real arm to the busy E2E. It drives the **real** shipped `worker-driver.js` with ≥1 genuinely in-flight dispatched worker (fixture worker command, real dispatch record), issues `restart --kind worker`, and asserts: confirm within seconds; the in-flight worker is still alive and is adopted by the new loop; its fan-in runs exactly once; no double dispatch.
2. Negative control: the same arm on the pre-detach kernel yields `stop-failed` / `restart-aborted`.
3. Keep the existing AC2a fixture arm (it pins §6.9 inv.3).

## Acceptance Criteria
- [x] AC1: the AC2a-real arm on the pre-detach kernel reproduces `stop-failed` / `restart-aborted` (pasted).
- [x] AC2: the same arm on the post-detach kernel confirms, keeps the worker alive, adopts it, fans it in once, and does not double-dispatch (pasted).
- [x] AC3: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC3 checked with pasted evidence; the arm runs in the suite lane.

## Evidence

**Harness.** New case `AC2a-real` in `plugin/test/driver-restart-busy-e2e.test.mjs` (runs in the `lowconc` suite lane; 14.0s). TWO shipped-layout kernels, differing **only** in the worker bundle: the shipped loop, and a PRE-DETACH variant built from the SAME source with the kind-stop exit disabled (`predetachWorkerSource` forces `stopRequestedNow = false`; it fails closed if that anchor line is gone, so the control cannot go vacuous). The anchor hosts the worker kind, so `restart --kind worker` is the production path (`stopKindViaAnchor`). The kernel's `scripts/dist/worker-driver.js` is a 3-line wrapper that appends ONLY the four documented test seams (`--worker-cmd-exact` / `--ready-pool-cmd` / `--selector-cmd` / `--resource-gate-cmd` — the anchor composes the kind argv itself, so there is no argv path for them otherwise) and forwards to the REAL bundle; the loop under test is the real one. The in-flight worker is genuine: the real loop selected the task, wrote a REAL dispatch record, and spawned a live fixture process (`node -e setTimeout(()=>{},611000) quay-task-worker gap-e2e-busy-restart`).

**AC1 — PRE-DETACH kernel, genuinely in-flight worker, `restart --kind worker` (stop window shrunk to 3000ms via the `StopOptions` test seam, same as the file's AC5).**
```
[evidence AC1] { "kernel": "pre-detach (kind-stop exit disabled)", "rc": 1, "wall_ms": 3021,
 "stop_failed": "stop-failed: kind=worker — 该 kind 的循环在 3000ms 内未收尾（anchor pid=1268300）。⛔ 本条**不报成 not-running**：循环仍在 ⇒ 接着 start 会得到两份 loop（双派发）。期望态：已把 worker 放回（restart 中止 ⇒ 「该 kind 应该在跑」仍成立）。",
 "restart_aborted": "restart-aborted: kind=worker — stop 未确认旧进程树已退出（exit=1）；⛔ 不起新循环（否则与旧 loop 双派发）。",
 "in_flight_worker_pid": 1268434, "worker_alive_after": true, "stop_record_present": true }
```
The stop request DID reach the loop (the on-disk `.quay/anchor-kind-stops.json` record is present) — the loop just cannot act on it — so the failure is the exit condition, not a lost signal (硬规则 3b). No `started:` line: an aborted restart does not start a second loop.

**AC2 — SHIPPED (post-detach) kernel, same arm.**
```
[evidence AC2] { "kernel": "shipped (current source)",
 "confirm_line": "started: anchor pid=1273666 kind=worker driver pid=1273666 confirmed_ms=503",
 "confirmed_ms": 503, "restart_wall_ms": 3119, "stop_failed_present": false,
 "in_flight_worker_pid": 1273897, "workers_alive_after_restart": [1273897],
 "worker_loop_started": "1 -> 2", "dispatch_record_unchanged": true,
 "adopted_outcome": { "task": "gap-e2e-busy-restart", "exit_code": null, "wall_clock_ms": 4051,
   "final_state": "exited-not-landed", "failure_reason": "resumed orphan worker (exit status unobservable) — task status=ready (not done)",
   "worker_pid": 1273897, "run_id": "wk-prod-anchor", "adopted_after_exit": true },
 "one_fan_in_outcome": 1 }
```
Confirms in **503ms** (no `stop-failed`); the SAME in-flight worker pid is still alive and is the ONLY fixture worker (no kill, no double dispatch); exactly one new worker loop (`1 -> 2`) and the anchor pid is unchanged; the dispatch record is byte-identical across the restart. The worker is then SIGKILLed INSIDE the new loop's tenure: the ADOPTING loop writes the terminal outcome **exactly once** (`adopted_after_exit: true`, `exit_code: null` — no fabricated status, 硬规则 3b), i.e. the post-exit fan-in pipeline ran once and refused on its own AC grounds (the task's status is `ready`, not `done` — the same allowed outcome AC2b/AC3 record; a scratch host declares no suite, so a real fan-in could only refuse anyway).

**AC3 — `bash scripts/test.sh --for-task gap-busy-restart-e2e-ac2a-fixture-replaces-real-worker-driver-so-in-flight-restart-gate-is-untested --allow-thin`**
```
EXIT=0   (scoped static checks: all PASS; test-isolation 21/21 baselined; landing-target 0 violations; valueSccs/typeSccs/reverseEdges 0)
✔ AC1  ... ✔ AC4 ... ✔ AC5 ... ✔ AC2a ... ✔ AC2a-real ... ✔ AC2b ... ✔ AC3 ...
ℹ tests 7   ℹ pass 7   ℹ fail 0
```
Anti-drift Touches check on the same worktree vs `develop`: `ANTI-DRIFT OK … 1 actual file(s), all within declared Touches`.

## Touches
- tasks/gap-busy-restart-e2e-ac2a-fixture-replaces-real-worker-driver-so-in-flight-restart-gate-is-untested.md
- plugin/test/driver-restart-busy-e2e.test.mjs

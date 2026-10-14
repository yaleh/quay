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
- [ ] AC1: the AC2a-real arm on the pre-detach kernel reproduces `stop-failed` / `restart-aborted` (pasted).
- [ ] AC2: the same arm on the post-detach kernel confirms, keeps the worker alive, adopts it, fans it in once, and does not double-dispatch (pasted).
- [ ] AC3: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC3 checked with pasted evidence; the arm runs in the suite lane.

## Touches
- tasks/gap-busy-restart-e2e-ac2a-fixture-replaces-real-worker-driver-so-in-flight-restart-gate-is-untested.md
- plugin/test/driver-restart-busy-e2e.test.mjs

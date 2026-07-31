---
id: gap-select-preflight-getTaskList-timeout-too-short
title: select-preflight.ts's getTaskList() hardcodes a 60s execFileSync timeout,
  shorter than measured real `quay task list --json` wall time (66-78s) against
  the current (475+ task) store — every live select-preflight.ts --json run can
  halt before producing a portfolio, though timing is variable/non-deterministic
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs
---
## Proposal

Raise (or make configurable/derived-from-store-size) the `timeout: 60000` passed to `execFileSync`
in `select-preflight.ts`'s `getTaskList()`, so a real, growing task store does not intermittently
starve every live SELECT preflight cycle before it can produce a portfolio.

## Finding

Discovered 2026-07-29 during DIR-119-D1's (M198) Build phase: `select-preflight.ts --json` halted
with `FAIL-CLOSED: could not read task store (quay task list --json failed)`, blocking the AC14/
AC15/AC18 live-dispatch evidence tiers. Build measured real `quay task list --json` wall time at
66-78s against the current (475+ task) store — longer than `getTaskList()`'s own hardcoded 60000ms
`execFileSync` timeout (`experiments/quay-perpetual-stream/scripts/select-preflight.ts` line 436).

Timing is variable: a later re-run in this same session (same store, same environment) completed
in ~14s and succeeded. This is consistent with a real timeout race under load/caching variance, not
a deterministic hard failure — which makes it more dangerous, not less: a flaky, timing-dependent
FAIL-CLOSED on a hot path (every SELECT cycle) is worse than a deterministic one, since it will
intermittently and unpredictably block the autonomous loop's own `select()` step depending on
system load at the moment it runs.

`getTaskList()` is called from `select-preflight.ts`'s own `main()`/`buildPreflightResult()` path —
the single real callsite this script's `--json` CLI mode and the DSL-wrapped `select-preflight.js`
workflow both depend on. Not fixed inline as part of DIR-119-D1 (M198): `select-preflight.ts` is
not in that task's declared `## Touches` (only the `.js` DSL wrapper is), and DIR-119-D1's own
Non-goals scope excludes editing sibling checker/script internals outside its declared touch set.

## Requested action

1. Raise the hardcoded 60000ms timeout to a value with real headroom over measured wall time (e.g.
   120000ms), or derive it from the real task count (`quay task list --json` wall time scales with
   store size) so it does not need manual re-tuning as the store grows.
2. Add a regression test asserting `getTaskList()`'s timeout is not silently reverted below a
   documented floor.

## Acceptance Criteria

- [x] `getTaskList()`'s `execFileSync` timeout is raised with a code comment citing the measured
  66-78s real wall-time baseline this Finding recorded, giving real headroom (not just enough to
  pass once). (`GETTASKLIST_TIMEOUT_MS_FLOOR = 120000`, ~1.5-1.8x the measured worst case.)
- [x] A regression test in `experiments/quay-perpetual-stream/test/select-preflight.test.mjs`
  asserts the timeout value is at or above the documented floor. (32/32 tests pass, independently
  re-run by a fresh reviewer.)
- [x] Canonical and `plugin/scripts/` mirror (if `select-preflight.ts` has one) stay byte-identical
  after the edit — confirmed via `cmp`/`sync-vendor.sh --check`. (No `plugin/scripts/` mirror
  exists for this file — vacuously satisfied, confirmed via `find`.)

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master`. (commit `28870e5`)
- [x] A real `select-preflight.ts --json` run against the current task store, timed, is captured as
  command output showing real headroom over the new timeout (not merely a source-level assertion).
  (Independent reviewer's own real run: `real 0m16.668s`, exit 0, valid JSON — ~103s headroom
  under the new 120000ms timeout.)

## Touches

- experiments/quay-perpetual-stream/scripts/select-preflight.ts
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs

## Execution record

Executed directly (mixed mode, 2026-07-31, per explicit user instruction). Build commit `28870e5`.
Independent verification via a fresh subagent reviewer standing in for Audit: verdict CONCERNS
(purely because the review ran before the Land commit landed — expected sequence; no code defect
found; also independently confirmed the task's Finding numbers match the code/test exactly and
noted a non-blocking observation that 120s vs 60s means a genuine hang takes twice as long to
fail-closed, an accepted tradeoff since 66-78s is real legitimate work time per the Finding).

**Outcome:** done.

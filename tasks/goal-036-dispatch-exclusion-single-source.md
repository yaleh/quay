---
id: goal-036-dispatch-exclusion-single-source
title: WorkerPool 在飞排除集合单一来源化实现：computeDispatchExclusion 收敛 inFlightTasks()
  的两次独立调用（GOAL-036 落地任务，分支 goal/GOAL-036）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-359
---
**type:** execution

## Proposal

Land GOAL-036's slice on branch `goal/GOAL-036`: in `plugin/scripts/worker-driver.ts`'s resident dispatch loop (`runResidentLoop`), the closure `inFlightTasks()` (line ~5224: `running.map((r) => r.task).concat([...coldInflight])`) is called independently TWICE within one round — once at line ~5740 (fed into `readyPoolCheck(...)`, an `await`ed async subprocess call) and again at line ~5753 (fed into `makeFilterContext(...)`). Between these two calls is an `await`, so if `coldInflight`/`running` mutate during that window, the two reads of "what's currently in flight" can disagree, even though both consumers should see the same round snapshot. This is the same bug *shape* (not the same instance) as the already-fixed `gap-worker-driver-cold-start-inflight-blind`/`-refresh` incidents. Fix: compute the exclusion set ONCE per round via a new pure function, and have both consumers read that one value.

**Critical scope boundary — read before touching anything**: do NOT fold backoff (`isBackedOff`/`Date.now()`) into the new function. The existing code at line ~5758 (`.filter((id) => !isBackedOff(backoffState, id, Date.now()))`) has a comment explicitly stating backoff must be evaluated per-candidate with a FRESH `Date.now()` at filter time, not pre-computed into a round-start snapshot — doing so would reintroduce a previously-fixed bug (`gap-worker-driver-selector-api-error-no-backoff` AC2). The new function covers ONLY `{inFlight, retryExhausted}`.

## Plan

1. In `plugin/scripts/driver-filters.ts`, add a new exported pure function (place it near `FilterContext`/`RetryState`, which already live in this file):
   ```ts
   export function computeDispatchExclusion(
     running: { task: string }[],
     coldInflight: Set<string>,
     retryState: RetryState,
   ): { inFlight: string[]; retryExhausted: Set<string> } {
     return {
       inFlight: running.map((r) => r.task).concat([...coldInflight]),
       retryExhausted: retryState.needsHuman,
     };
   }
   ```
   (Match the exact shape `inFlightTasks()` currently produces — this must be a behavior-preserving extraction, not a redesign. Adjust the `running` parameter type to whatever the real `RunningWorker` type's relevant field is called — verify by reading `worker-driver.ts`'s actual `RunningWorker` interface before writing this, don't guess the field name.)
2. In `worker-driver.ts`'s `runResidentLoop`, right after the `step = "ready-pool"` assignment and before the `readyPoolCheck(...)` call (~line 5740), add one call: `const exclusion = computeDispatchExclusion(running, coldInflight, retryState);`. Replace the `inFlightTasks()` argument at line ~5740 with `exclusion.inFlight`, and replace the `{ inFlight: inFlightTasks(), retryExhausted: retryState.needsHuman }` at line ~5753 with `{ inFlight: exclusion.inFlight, retryExhausted: exclusion.retryExhausted }`.
3. Do NOT remove the `inFlightTasks()` closure itself if it's used elsewhere in the file (check first — it's referenced near lines 5266/5316 for round/error reporting, which are a DIFFERENT concern — leave those call sites alone, they're not part of this slice's scope; only the two dispatch-path call sites at ~5740/~5753 are in scope).
4. Verify after the edit: between the `step = "ready-pool"` and `step = "apply-filters"` markers in `worker-driver.ts`, `computeDispatchExclusion(` should appear exactly once, and `inFlightTasks()` should appear zero times in that same window (it may still appear elsewhere in the file for the unrelated round-reporting call sites — that's fine, out of scope).
5. Do NOT touch: `isBackedOff`, the backoff filter's `Date.now()` call, `advanceRetryCap`, `RetryState`'s own definition, `promotion-driver.ts`, or any file under `packages/quay/src/gate/`, `goal-store.ts`, `goal-merge.ts`, `worker-fan-in.ts`, `ready-pool-check.ts` — all explicitly out of scope for this goal.
6. Add tests to `plugin/test/driver-filters.test.mjs` for `computeDispatchExclusion`: (a) a basic-correctness test (given a `running` array and a `coldInflight` set, assert the returned `inFlight` array contains exactly the expected task ids, and `retryExhausted` is the same Set reference/contents as `retryState.needsHuman`); (b) a determinism/purity negative control — call the function twice with the SAME inputs and assert the two outputs are deep-equal (`assert.deepStrictEqual`) — this is the concrete evidence that the function is a pure snapshot, not something that could drift between two calls the way the old two-call pattern could.
7. Run `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` — must be fully green.
8. Run `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` — large file (~6000+ lines in this file currently); must be fully green (allow extra wall-clock time).
9. Run `npx tsc --noEmit` (or this repo's equivalent typecheck gate) to confirm no type errors.
10. Evaluate AC-359 and AC-360 on this branch (`quay goal gate AC-359`, `quay goal gate AC-360 --timeout 900000`) — both must read exit 0. AC-361 is post-merge and is NOT expected to pass yet from this branch.

## Acceptance Criteria

- [ ] `computeDispatchExclusion` is defined exactly once in `driver-filters.ts`, is a pure function (no `fs`/`spawn`/`await` inside it), and does NOT reference `isBackedOff`/backoff in any form.
- [ ] Between `worker-driver.ts`'s `step = "ready-pool"` and `step = "apply-filters"` markers, `computeDispatchExclusion(` appears exactly once and `inFlightTasks()` appears zero times.
- [ ] The backoff filter immediately after `step = "apply-filters"` still calls `Date.now()` per-candidate, unchanged.
- [ ] `advanceRetryCap`, `RetryState`'s definition, and `isBackedOff` are all unchanged.
- [ ] `git diff --name-only develop...HEAD` does not touch any file under `packages/quay/src/gate/`, nor `goal-store.ts`, `goal-merge.ts`, `worker-fan-in.ts`, `ready-pool-check.ts`, or `promotion-driver.ts`.
- [ ] `plugin/test/driver-filters.test.mjs` has new tests for `computeDispatchExclusion` covering basic correctness and a determinism/purity negative control (`assert.deepStrictEqual` on two calls with identical inputs); file is fully green.
- [ ] `plugin/test/worker-driver.test.mjs` is fully green (full-file regression).
- [ ] Typecheck passes.
- [ ] `quay goal gate AC-359` reads exit 0 on this branch.
- [ ] `quay goal gate AC-360 --timeout 900000` reads exit 0 on this branch.

## Definition of Done

The slice lands on `goal/GOAL-036` with AC-359 and AC-360 both reading exit 0 when evaluated on this branch, both affected test files green, and no out-of-scope file touched. This task does not merge the goal branch into develop (a separate human-triggered `quay goal merge` step) and does not evaluate AC-361 (post-merge only). Because this slice modifies `worker-driver.ts`'s own dispatch loop — the same driver that will execute the mechanical fan-in for this task — be especially careful that the resident loop cannot throw on either the ready-pool or apply-filters path; the full regression run in step 8 is the safety net for exactly this risk.

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/worker-driver.ts
- plugin/test/driver-filters.test.mjs

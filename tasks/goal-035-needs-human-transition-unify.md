---
id: goal-035-needs-human-transition-unify
title: WorkerPool needs-human
  终态转移收敛实现：三条路径（stop-terminal/retry-cap/quick-death）统一到
  applyNeedsHumanTransition（GOAL-035 落地任务，分支 goal/GOAL-035）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  role: primitive
goal_ac: AC-356
---
**type:** execution

## Proposal

Land GOAL-035's slice on branch `goal/GOAL-035`: unify the 3 independent "mark this task needs-human" pathways inside `plugin/scripts/worker-driver.ts`'s `onWorkerFinished(rw, r)` closure (currently around lines 5272-5395, inside `runResidentLoop`) so they all go through one owned function `applyNeedsHumanTransition` in `plugin/scripts/driver-filters.ts`, fixing two real bugs along the way: (1) the quick-death-backoff path's transition is currently invisible in `needsHumanResults`/the `needs-human` json event stream (the other two paths record it, this one doesn't — read GOAL-035's body for the full before/after); (2) the quick-death path's disk commit is mislabelled with the default `NeedsHumanKind` (`"retry-cap"`) instead of its real cause. Full investigation and the exact ownership rationale are in GOAL-035's body — read it first.

## Plan

1. In `plugin/scripts/driver-filters.ts`, add `"quick-death-backoff"` to the `NeedsHumanKind` union type (currently `"retry-cap" | "stop-terminal" | "other"`).
2. In the same file, add an exported function:
   ```ts
   export function applyNeedsHumanTransition(
     state: RetryState,
     root: string,
     write: { id: string; reason: string; kind: NeedsHumanKind },
     opts: { countsOverride?: number } = {},
   ): { id: string; ok: boolean; reason: string; committed: boolean } {
     if (!state.needsHuman.has(write.id)) {
       state.needsHuman.add(write.id);
       if (opts.countsOverride !== undefined) state.counts.set(write.id, opts.countsOverride);
     }
     return markNeedsHuman(root, write.id, write.reason, write.kind);
   }
   ```
   Place it near `advanceRetryCap`/`markNeedsHuman` with a doc comment explaining it is the SINGLE owner of the pairing between the in-memory latch and the disk commit, and that callers must route every needs-human transition through it rather than touching `state.needsHuman`/`state.counts` directly.
3. In `worker-driver.ts`'s `onWorkerFinished`:
   - **Path A (stop-terminal)**: currently guards with `if (!retryState.needsHuman.has(r.taskId)) { retryState.needsHuman.add(...); retryState.counts.set(r.taskId, maxRetries); needsHumanWrites.push({id, reason, kind: "stop-terminal"}); }`. Remove the direct `.add`/`.set` calls from this block (keep the `if (!retryState.needsHuman.has(...))` guard controlling whether to push at all, to preserve "don't re-enqueue an already-needs-human task" behavior) — the mutation now happens inside `applyNeedsHumanTransition` when the entry is processed in step 4. Add a `countsOverride: maxRetries` field to this pushed entry's shape (or otherwise thread `maxRetries` through to the processing loop for this entry specifically — stop-terminal entries get their counts force-set to maxRetries, matching current behavior exactly).
   - **Path B (retry-cap via `advanceRetryCap`)**: unchanged — `advanceRetryCap` already does its own correct mutation and returns ids to push into the same `needsHumanWrites` array (no `countsOverride` needed, since `advanceRetryCap` already set counts itself).
   - **The shared processing loop** (`for (const w of needsHumanWrites) { const nh = markNeedsHuman(rootDir, w.id, w.reason, w.kind); needsHumanResults.push(nh); ... }`): replace the direct `markNeedsHuman(...)` call with `applyNeedsHumanTransition(retryState, rootDir, w, w.countsOverride !== undefined ? { countsOverride: w.countsOverride } : {})`, keep capturing into `nh`/`needsHumanResults`/the json event exactly as before.
   - **Path C (quick-death, `if (backoff.newlyNeedsHuman) { ... }`)**: replace `retryState.needsHuman.add(r.taskId); markNeedsHuman(rootDir, r.taskId, reason);` with a call to `applyNeedsHumanTransition(retryState, rootDir, { id: r.taskId, reason, kind: "quick-death-backoff" })`, capture the result, push it into `needsHumanResults` (the same array path A/B use), and emit a `needs-human` json event matching the shape the shared loop emits for A/B (same event name, same fields) — this is the actual bug fix: path C's transition becomes visible in production telemetry the same way A/B's already are.
4. Verify after the edit: `grep -c "retryState.needsHuman.add(" plugin/scripts/worker-driver.ts` and `grep -c "retryState.counts.set(" plugin/scripts/worker-driver.ts` are both 0 (the only mutation site left is inside `applyNeedsHumanTransition` in `driver-filters.ts`, not in `worker-driver.ts`).
5. Do NOT touch (non-goals — a stop-and-reconsider signal, not something to clean up along the way): `advanceRetryCap`, `reconcileNeedsHumanWithDisk`, `markNeedsHuman`'s own signature, `recordQuickDeathBackoff`, the `environment-fatal` branch (it must keep its hard `return r;` before any needs-human code, unchanged), and any of `promotion-driver.ts`/`meta-driver.ts`/`quality-gate-driver.ts`/`outer-driver.ts`/`goal-driver.ts`/`driver-runtime.ts`/`driver-shared.ts`/`driver-config.ts`.
6. Add tests to `plugin/test/driver-filters.test.mjs` for `applyNeedsHumanTransition`: (a) an accept-path test (valid root with a real task present) asserting `{ok:true, committed:true}` and that `state.needsHuman.has(id)` is now true; (b) a surfaced-failure test mirroring the existing "AC4 — markNeedsHuman in a repo-less temp dir is a commit no-op (committed:false, no throw)" test already in this file (around line 426) — call `applyNeedsHumanTransition` against a repo-less temp dir and assert it returns `{ok:false, committed:false}` WITHOUT throwing, proving the function's caller cannot accidentally lose a failure the way the old quick-death call site did; (c) an idempotency test — call it twice with the same id and a `countsOverride`, assert the second call does not re-apply the override (state.needsHuman already has it).
7. Run `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` — must be fully green.
8. Run `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` — this is a large file (4379 lines); must be fully green (allow extra wall-clock time for this step, it is the regression gate for every real call site of the changed code).
9. Run `npx tsc --noEmit` (or this repo's equivalent typecheck gate) to confirm no type errors.
10. Evaluate AC-356 and AC-357 on this branch (`quay goal gate AC-356`, `quay goal gate AC-357 --timeout 900000`) — both must read exit 0. AC-358 is post-merge and is NOT expected to pass yet from this branch.

## Acceptance Criteria

- [ ] `NeedsHumanKind` includes `"quick-death-backoff"`.
- [ ] `applyNeedsHumanTransition` is defined exactly once in `driver-filters.ts`, pairs the in-memory latch with the disk commit, and returns the disk-commit result unconditionally.
- [ ] `worker-driver.ts` has zero direct `retryState.needsHuman.add(`/`retryState.counts.set(` calls; all 3 real call sites (stop-terminal, retry-cap, quick-death) route through `applyNeedsHumanTransition`.
- [ ] The quick-death path now pushes its result into `needsHumanResults` and emits a `needs-human` json event, matching the other two paths.
- [ ] `advanceRetryCap`, `reconcileNeedsHumanWithDisk`, `markNeedsHuman`'s signature, `recordQuickDeathBackoff`, and the `environment-fatal` hard-return branch are all unchanged.
- [ ] `git diff --name-only develop...HEAD` does not touch any of the other six driver files listed as non-goals.
- [ ] `plugin/test/driver-filters.test.mjs` has new tests for `applyNeedsHumanTransition` covering accept, surfaced-failure (not thrown/swallowed), and idempotency; file is fully green.
- [ ] `plugin/test/worker-driver.test.mjs` is fully green (full-file regression, not just a subset).
- [ ] Typecheck passes.
- [ ] `quay goal gate AC-356` reads exit 0 on this branch.
- [ ] `quay goal gate AC-357 --timeout 900000` reads exit 0 on this branch.

## Definition of Done

The slice lands on `goal/GOAL-035` with AC-356 and AC-357 both reading exit 0 when evaluated on this branch, both affected test files green, and no out-of-scope file touched. This task does not merge the goal branch into develop (a separate human-triggered `quay goal merge` step) and does not evaluate AC-358 (post-merge only). Because this slice modifies `worker-driver.ts` itself — the same driver that will execute the mechanical fan-in for this task — be especially careful that `onWorkerFinished` cannot throw on any of its 3 paths; the full regression run in step 8 is the safety net for exactly this risk.

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/worker-driver.ts
- plugin/test/driver-filters.test.mjs
- tasks/goal-035-needs-human-transition-unify.md

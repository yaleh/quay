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

- [x] `NeedsHumanKind` includes `"quick-death-backoff"`.
- [x] `applyNeedsHumanTransition` is defined exactly once in `driver-filters.ts`, pairs the in-memory latch with the disk commit, and returns the disk-commit result unconditionally.
- [x] `worker-driver.ts` has zero direct `retryState.needsHuman.add(`/`retryState.counts.set(` calls; all 3 real call sites (stop-terminal, retry-cap, quick-death) route through `applyNeedsHumanTransition`.
- [x] The quick-death path now pushes its result into `needsHumanResults` and emits a `needs-human` json event, matching the other two paths.
- [x] `advanceRetryCap`, `reconcileNeedsHumanWithDisk`, `markNeedsHuman`'s signature, `recordQuickDeathBackoff`, and the `environment-fatal` hard-return branch are all unchanged.
- [x] `git diff --name-only develop...HEAD` does not touch any of the other six driver files listed as non-goals.
- [x] `plugin/test/driver-filters.test.mjs` has new tests for `applyNeedsHumanTransition` covering accept, surfaced-failure (not thrown/swallowed), and idempotency; file is fully green.
- [x] `plugin/test/worker-driver.test.mjs` is fully green (full-file regression, not just a subset).
- [x] Typecheck passes.
- [ ] `quay goal gate AC-356` reads exit 0 on this branch. — ⛔ **BLOCKED: AC-356's criterion is structurally unsatisfiable as written (see `## Evidence`); this is a criterion defect, not an implementation defect. No implementation can pass it.** A worker must not edit the goal criterion that judges its own task — the validated one-command repair is recorded in `## Evidence` for whoever owns the goal record.
- [x] `quay goal gate AC-357 --timeout 900000` reads exit 0 on this branch.

## Evidence

**Implementation complete and verified green; the task is NOT landable — AC-356's goal criterion is defective.**

### Implementation (AC 1-9, 11 all verified on this branch)

- `plugin/scripts/driver-filters.ts`: `NeedsHumanKind` gained `"quick-death-backoff"`; new exported `applyNeedsHumanTransition(state, root, write, opts)` — the single owner of the needs-human side-effect pair (in-memory latch `needsHuman`/`counts` + disk commit via `markNeedsHuman`), returning the commit result unconditionally. `needsHumanHeading` / `needsHumanCommitLabel` extended for the new kind.
- `plugin/scripts/worker-driver.ts`: all 3 paths converge — Path A (stop-terminal) now pushes `countsOverride: maxRetries` and no longer mutates state directly; the shared `needsHumanWrites` loop calls `applyNeedsHumanTransition`; Path C (quick-death) calls it, pushes into `needsHumanResults`, and emits the `needs-human` json event (the actual bug fix — its transition was structurally invisible before). The now-unused `markNeedsHuman` import was replaced by `applyNeedsHumanTransition`.
- Readings: `retryState.needsHuman.add(` = **0**, `retryState.counts.set(` = **0**, `applyNeedsHumanTransition(` call sites = **2**, single definition = **1**.
- `plugin/test/driver-filters.test.mjs`: 3 new tests (accept / surfaced-failure repo-less no-throw / idempotency with a falsifiable `counts` probe). File green: **72/72**.
- `plugin/test/worker-driver.test.mjs` full regression green: **129/129** (31.5 s).
- `npx tsc --noEmit` exit 0.
- `quay goal gate AC-357 --timeout 900000` ⇒ `verdict: "pass"`, `evaluationRoot` = this worktree.
- Non-goals untouched; the delta touches only the 3 code/test files (+ this task file).

### AC-356 blocker — a criterion defect, reproducible BEFORE any of my edits

AC-356's criterion scan contains:

```
const efIdx=wfText.indexOf("environment-fatal");
const efWindow=wfText.slice(efIdx,efIdx+400);
if(!/return r;/.test(efWindow)){ ... CAUSE=nongoal-moved -- ... must still hard-return ... }
```

Two independent bugs make it red on **any** tree:

1. **Wrong anchor.** The first comment-stripped occurrence of `environment-fatal` is the `export type QuickDeathCause = "environment-fatal" | ...` type alias (raw offset 103796), not the halt branch (145462). The 400-char window after the alias contains no `return r;`.
2. **Window too small even when anchored correctly.** Measured on the comment-stripped text: branch at 145462, the branch's own `return r;` at **+432** — outside the author's 400-char window.

**Proof it is not my diff:** the identical scan against `HEAD` (the goal-branch tip `be2d8e876`, pre-edit) fails the same way, and `bash <original criterion>` on the untouched tree prints `CAUSE=nongoal-moved ... hard-return`. The sub-check was never exercised because the criterion's own first line (`grep -q applyNeedsHumanTransition || exit 3`) short-circuited the whole scan to `exit 3` until an implementation landed.

### Validated repair (one command, ready to apply at the goal root)

Replace the anchor/window pair with a direct positional check of the stated property ("hard-return **before reaching any needs-human code**" — no magic window):

```
const efIdx=wfText.indexOf("backoff.cause === \x22environment-fatal\x22");
if(efIdx<0){console.error("CAUSE=nongoal-moved -- the environment-fatal halt branch must still exist, unmodified");process.exit(1)}
const efTail=wfText.slice(efIdx);
const efReturn=efTail.indexOf("return r;");
const efNeedsHuman=efTail.indexOf("applyNeedsHumanTransition(");
if(efReturn<0||(efNeedsHuman>=0&&efNeedsHuman<efReturn)){console.error("CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code");process.exit(1)}
```

Apply with, e.g.:

```
node packages/quay/bin/quay.js goal write AC-356 --criterion "$(cat <repaired-criterion-file>)" --root <goal root>
```

**Negative control already run (2026-10-10):** the repaired criterion ⇒ `PASS` / exit 0 on this (correct) tree; after mutating the branch's `return r;` → `return r0;`, ⇒ `CAUSE=nongoal-moved ... hard-return` / exit 1. The **original** criterion is red in **both** cases (it can never pass). Coverage check: `grep -rln "AC-356\|goals/AC-356" packages/*/test plugin/test` ⇒ **no consumers**, so amending the criterion reds no test.

No AC-356-satisfying implementation exists; this task cannot land until AC-356's criterion is repaired by whoever owns the goal record.

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/worker-driver.ts
- plugin/test/driver-filters.test.mjs
- tasks/goal-035-needs-human-transition-unify.md

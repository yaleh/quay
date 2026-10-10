---
id: goal-035-needs-human-transition-contract-tests
title: GOAL-035 AC-357 落地：applyNeedsHumanTransition 函数级两态契约测试（accept +
  surfaced-failure）落地，driver-filters.test.mjs 与 worker-driver.test.mjs 全量回归绿（分支
  goal/GOAL-035）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  role: primitive
depends_on:
  - goal-035-needs-human-transition-unify
goal_ac: AC-357
---
## Proposal

GOAL-035 splits its slice into AC-356 (production-code structural guard: `applyNeedsHumanTransition` becomes the single mutator of `retryState.needsHuman`/`counts`, `NeedsHumanKind` gains `"quick-death-backoff"`, and the quick-death path becomes observable in `needsHumanResults`/the `needs-human` json stream) and AC-357 — this task: the **function-level, falsifiable contract** for that function, plus the full regression of both affected test files. Read GOAL-035's body and AC-357's own `criterion` before starting; the criterion IS the definition of done here, and it is quoted in the DoD below.

<!-- dedup-ref --> Related sibling: `goal-035-needs-human-transition-unify` (status `ready`, `goal_ac: AC-356`) owns the AC-356 production-code half, and its own plan additionally sketches the AC-357 tests. Kept as a separate task rather than merged, for two reasons: (a) AC-357's criterion is only satisfiable once `applyNeedsHumanTransition` exists — it exits 3 with `NOT-EVALUATED` otherwise — so it is a distinct, later-satisfiable deliverable; (b) `goal_ac` is a single top-level scalar, so one task cannot own both AC-356 and AC-357, and GOAL-035's AC split assigns the production code to AC-356 and the contract tests + regression to AC-357.

## Plan

1. Confirm the function under test exists: `grep -n "applyNeedsHumanTransition" plugin/scripts/driver-filters.ts` must hit an exported definition returning `{ id, ok, reason, committed }`. If it does not, AC-357's criterion exits 3 — this task is waiting on the AC-356 sibling, which is the declared dependency.
2. In `plugin/test/driver-filters.test.mjs`, add tests for `applyNeedsHumanTransition` so the file references the identifier at least twice:
   - **accept path** — a valid root with a real task present ⇒ returns `{ ok: true, committed: true }` and `state.needsHuman.has(id) === true`;
   - **surfaced-failure path** — a repo-less temp dir, mirroring the file's existing "`markNeedsHuman` in a repo-less temp dir is a commit no-op (`committed:false`, no throw)" test ⇒ returns `{ ok: false, committed: false }` and does NOT throw, proving the failure propagates to the caller instead of being swallowed (which is the exact defect the old quick-death call site had: it discarded `markNeedsHuman`'s return value).
3. Ensure the file carries an explicit assertion of the failure shape: `grep -qi "committed.*false\|ok.*false" plugin/test/driver-filters.test.mjs` must match.
4. `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` — must be fully green.
5. `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` — must be fully green. This file is large (4379 lines); this is the real call-site regression, since every worker exit in production runs through `onWorkerFinished`.
6. On branch `goal/GOAL-035`, run `quay goal gate AC-357 --timeout 900000` and require exit 0.

## Acceptance Criteria

- [ ] `grep -c "applyNeedsHumanTransition" plugin/test/driver-filters.test.mjs` is ≥ 2 (one accept case, one surfaced-failure case).
- [ ] The test file asserts the `ok:false` / `committed:false` failure shape is returned (propagated), not thrown and not swallowed — `grep -qi "committed.*false\|ok.*false" plugin/test/driver-filters.test.mjs` matches.
- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` exits 0.
- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` exits 0 (full-file regression, not a subset).
- [ ] `quay goal gate AC-357 --timeout 900000` reads exit 0 on branch `goal/GOAL-035`.

## Definition of Done

`quay goal gate AC-357` — run at the `goal/GOAL-035` tip — exits 0. That criterion mechanically (i) greps `plugin/scripts/driver-filters.ts` and the test file for `applyNeedsHumanTransition`, (ii) re-runs `driver-filters.test.mjs` and `worker-driver.test.mjs` and requires both green, (iii) counts ≥2 references in the test file, and (iv) requires an `ok:false`/`committed:false` assertion. So the real-landing bar is the criterion itself re-run and passing on the branch — not "tests were written". This task does not merge the goal branch into `develop` and does not evaluate AC-358 (post-merge only).

## Touches

- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/goal-035-needs-human-transition-contract-tests.md
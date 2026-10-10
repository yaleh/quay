---
id: goal-036-dispatch-exclusion-contract-tests
title: GOAL-036 AC-360 落地：computeDispatchExclusion 函数级契约测试（基本正确性 +
  确定性/纯度负对照）落地，driver-filters.test.mjs 与 worker-driver.test.mjs 全量回归绿（分支
  goal/GOAL-036）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  role: primitive
depends_on:
  - goal-036-dispatch-exclusion-single-source
goal_ac: AC-360
---
## Proposal

GOAL-036 splits its slice into AC-359 (production-code structural guard: a new pure `computeDispatchExclusion(running, coldInflight, retryState)` in `plugin/scripts/driver-filters.ts` becomes the single per-round computation point for `{inFlight, retryExhausted}`, replacing the two independent `inFlightTasks()` calls at `worker-driver.ts:5740` / `:5753`) and AC-360 — this task: the **function-level, falsifiable contract** for that function, plus the full regression of both affected test files. Read GOAL-036's body and AC-360's own `criterion` before starting; the criterion IS the definition of done here.

<!-- dedup-ref --> Related sibling: `goal-036-dispatch-exclusion-single-source` (status `ready`, `goal_ac: AC-359`) owns the AC-359 production-code half, and its own Plan step 6 additionally sketches the AC-360 tests. Kept as a separate task rather than merged, for two reasons: (a) AC-360's criterion is only satisfiable once `computeDispatchExclusion` exists — it exits 3 with `NOT-EVALUATED` otherwise — so it is a distinct, later-satisfiable deliverable; (b) `goal_ac` is a single top-level scalar, so one task cannot own both AC-359 and AC-360, and GOAL-036's AC split assigns the production code to AC-359 and the contract tests + regression to AC-360. Same split shape as GOAL-035's AC-356/AC-357 (see `goal-035-needs-human-transition-contract-tests`, `done`). `task-granularity-advice.ts` reports this sibling as the only Touches peer (shared `plugin/scripts/driver-filters.ts`); the scheduler serializes on Touches, so keeping them separate costs no parallelism.

## Plan

1. Confirm the function under test exists: `grep -n "computeDispatchExclusion" plugin/scripts/driver-filters.ts` must hit an exported definition returning `{ inFlight: string[]; retryExhausted: Set<string> }`. If it does not yet, AC-360's criterion exits 3 — the production-code half arrives via the AC-359 sibling named in this task's `depends_on`.
2. In `plugin/test/driver-filters.test.mjs`, add tests for `computeDispatchExclusion` so the file references the identifier at least twice:
   - **basic correctness** — given a `running` array (e.g. `[{task:"a"},{task:"b"}]`) and a `coldInflight` set (e.g. `new Set(["c"])`), assert the returned `inFlight` contains exactly the expected task ids (`["a","b","c"]`, pinned by the implementation's `running.map(...).concat([...coldInflight])` order), and `retryExhausted` equals `retryState.needsHuman`.
   - **determinism/purity negative control** — call the function TWICE with the SAME inputs and assert the two outputs are deep-equal (`assert.deepStrictEqual`). This is the concrete evidence that the function is a pure snapshot, not something that could drift between two calls the way the old two-call pattern could. Note: `grep -qi "deepStrictEqual\|deepEqual"` must match in the test file — the criterion requires it.
3. `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` — must be fully green.
4. `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` — must be fully green. This file is large (286980 bytes); this is the real call-site regression. Allow extra wall-clock and use a large `--timeout` when gating.
5. On branch `goal/GOAL-036`, run `quay goal gate AC-360 --timeout 900000` and require exit 0.
6. `grep -c "computeDispatchExclusion" plugin/test/driver-filters.test.mjs` must be >= 2.

## Acceptance Criteria

- [ ] `grep -c "computeDispatchExclusion" plugin/test/driver-filters.test.mjs` is >= 2 (one basic-correctness case, one determinism/purity case).
- [ ] The test file asserts the determinism/purity negative control: two calls with identical inputs produce deep-equal outputs — `grep -qi "deepStrictEqual\|deepEqual" plugin/test/driver-filters.test.mjs` matches.
- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` exits 0.
- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/worker-driver.test.mjs` exits 0 (full-file regression, not a subset).
- [ ] `quay goal gate AC-360 --timeout 900000` reads exit 0 on branch `goal/GOAL-036`.

## Definition of Done

`quay goal gate AC-360 --timeout 900000` — run at the `goal/GOAL-036` tip — exits 0. That criterion mechanically (i) greps `plugin/scripts/driver-filters.ts` and the test file for `computeDispatchExclusion`, (ii) re-runs `driver-filters.test.mjs` and `worker-driver.test.mjs` and requires both green, (iii) counts >=2 references in the test file, and (iv) requires a `deepStrictEqual`/`deepEqual` assertion to be present. So the real-landing bar is the criterion itself re-run and passing on the branch — not "tests were written". This task does not merge the goal branch into `develop` and does not evaluate AC-361 (post-merge only).

## Touches

- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/goal-036-dispatch-exclusion-contract-tests.md

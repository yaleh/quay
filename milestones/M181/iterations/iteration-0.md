# M181 iteration-0 — select-preflight shortlist leaks human-steered-excluded candidates

**Task:** exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK
**Charter:** experiments/quay-perpetual-stream/charters/M181-select-preflight-human-steered-leak.md
**Class:** development (execution / instrument-correction)

## What was done

Root cause: `select-preflight.ts`'s autonomous filter (`candidates.filter((c) => !c.humanSteered)`)
sourced `c.humanSteered` ONLY from `human-steered-classify.ts`'s `classify()` heuristic, which — per
its own DIR-062-C design comment ("classifier replaces label:human-steered filter") — deliberately
never reads a task's direct `label:human-steered`. Two independent leaks followed from this:

1. **Direct-label case**: a task carrying `label:human-steered` but touching only clean, non-driver
   files (e.g. DIR-057, DIR-113..DIR-116) passed the classifier with `humanSteered: false` and
   leaked into the shortlist.
2. **Epic-with-human-steered-only-child case**: a compound/epic candidate (DIR-070) whose own
   labels/touches are clean, but whose sole remaining OPEN child (DIR-070-F) is human-steered, also
   leaked in — nothing ever walked an epic's children before ranking it.

### Fix (`experiments/quay-perpetual-stream/scripts/select-preflight.ts`)

- Added `hasHumanSteeredLabel(labels)` — case-insensitive direct-label check, `null`/non-array safe.
- Added `computeHumanSteered(workspaceRoot, taskId, labels, extra, registry)` — the shared decision
  point: `classifyCandidate(...).humanSteered OR hasHumanSteeredLabel(labels)`. Used for BOTH
  top-level candidates and (via the epic walk below) each of an epic's children, so the OR logic
  exists in exactly one place.
- `buildPreflightResult`'s step 8 now calls `computeHumanSteered` instead of `classifyCandidate`
  directly for each candidate — the direct label is now an additional, never-overridden exclusion
  signal (case 1 fixed). `human-steered-classify.ts`'s own `classify()` / DIR-062-C 3-clause design
  is untouched, per the charter's explicit out-of-scope clause.
- Added `isEpicBlockedByHumanSteeredChildren(workspaceRoot, childIds, tasksById, registry)` — new
  step 8b in `buildPreflightResult`: for a `role: compound` candidate with non-empty `children`,
  looks up each child in the full raw task list (`tasksById`, built once from the same `quay task
  list --json` result already fetched), filters to currently-open (`status !== "done"`) children,
  and excludes the epic iff that open-child set is non-empty AND every member is human-steered (via
  the same `computeHumanSteered`). Vacuous case (zero open children) does NOT block — falls through
  to whatever the epic's own classification decided (case 2 fixed).
- `CandidateEntry` gained two optional fields, `role` and `children`, populated by `getCandidates`
  from the raw task view-model — needed so `buildPreflightResult` can walk an epic's children
  without a second task-store read. Fields are optional so existing test/selftest literals that
  construct `CandidateEntry` without them remain valid (treated as "not an epic").

## Fixtures (RED/GREEN pairs, both states shown per Done-when #2/#3)

Added to the embedded `selftest()` in `select-preflight.ts` (14 new `check()` calls) AND mirrored
as real `node:test` cases in `experiments/quay-perpetual-stream/test/select-preflight.test.mjs` (9
new tests, importing the newly-exported `hasHumanSteeredLabel`/`computeHumanSteered`/
`isEpicBlockedByHumanSteeredChildren`):

- **Case 1 RED**: `classifyCandidate` alone (the pre-fix consumption path) on a task touching only
  `packages/quay/src/gate/engine.ts` → `humanSteered: false`, reproducing the leak.
- **Case 1 GREEN**: `computeHumanSteered` on the same task + `labels: ["human-steered"]` →
  `humanSteered: true`, detail includes `label:human-steered (direct)`.
- **Case 2 RED**: the epic's own `computeHumanSteered` (no label, no driver-file touch) → `false`,
  reproducing the leak (nothing walks the children).
- **Case 2 GREEN**: `isEpicBlockedByHumanSteeredChildren` with one `done` child and one open child
  carrying `label:human-steered` (itself touching only clean files, isolating the label-OR fix as
  the closing mechanism) → `true`.
- **Regression** (Done-when #5): an epic whose open child carries no label and touches only clean
  files → `isEpicBlockedByHumanSteeredChildren` returns `false` — a genuinely autonomous-eligible
  candidate stays eligible.
- **Vacuous case**: an epic with zero currently-open children (all done) → not blocked (nothing to
  test).
- `hasHumanSteeredLabel` unit cases: case-insensitive match, no-match, `null`/non-array safety.

## Verification

- `node --experimental-strip-types select-preflight.ts --selftest` — all fixture cases PASS
  (43 `check()` calls total, up from 29 pre-fix).
- `node --test experimental-strip-types` (via `node --experimental-strip-types --test
  experiments/quay-perpetual-stream/test/select-preflight.test.mjs`) — **30/30 tests pass** (21
  pre-existing + 9 new M181 tests), confirming Done-when #4 (existing suite passes unmodified in
  count/intent, only new fixtures added).
- **Real live run** against the CURRENT task store (Done-when #1), confirming the fix closes the
  exact leak the charter's Value hypothesis names:
  ```
  node --experimental-strip-types select-preflight.ts --json --workspace-root . --milestone-counter 181
  ```
  DIR-057, DIR-070, DIR-113, DIR-114, DIR-115, DIR-116 — **all six absent from `candidates`**
  (filtered out as human-steered; verified each is `status: todo` + `label:milestone-candidate`, so
  each WOULD have been a raw candidate absent the fix). DIR-070 confirmed excluded specifically via
  the epic-child-walk path: its sole open child DIR-070-F carries `label:human-steered`, all 5
  other children are `done`.
- Full canonical `scripts/test.sh` (background, DIR-090 timeout discipline, ~289s): **533 pass, 1
  fail, 3 skipped**. The 1 failure (`plugin/test/plugin-packaging.test.mjs` — `task-schema.ts`
  bundled-copy byte-identity drift) is confirmed **pre-existing on `master`**, unrelated to this
  milestone: reproduced identically via `git stash` (running the same test against
  unmodified `master` fails the same way) and outside this milestone's `## Touches` scope. The 3
  skipped are the documented LIVE-GitHub tests, correctly skipping without
  `QUAY_TEST_LIVE_GITHUB=1`.

## Scope discipline

Per the charter's explicit Out-of-scope clause, `human-steered-classify.ts`'s own `classify()`
function and its DIR-062-C 3-clause design/rationale were NOT touched — the fix is entirely on
`select-preflight.ts`'s consumption side (an OR at the point the classifier's result is consumed),
exactly as scoped.

## Files changed

- `experiments/quay-perpetual-stream/scripts/select-preflight.ts`
- `experiments/quay-perpetual-stream/test/select-preflight.test.mjs`
- `tasks/exp5-DEFECT-SELECT-PREFLIGHT-HUMAN-STEERED-LEAK.md` (`extra.acceptance` pre-flight write)
- `milestones/M181/iterations/iteration-0.md` (this file)

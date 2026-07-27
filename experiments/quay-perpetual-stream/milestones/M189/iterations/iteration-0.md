# M189 / DIR-119-B iteration 0 — arbitrary-width composite milestone execution (Phase 2)

**Task:** DIR-119-B · **Charter:** `experiments/quay-perpetual-stream/charters/M189-dir119b-composite-execution.md`
**Plan:** `docs/plans/adaptive-composite-milestone-select-and-execution.md` §Phase 2 (Stages 2.1–2.6)

## Summary

Extends `execute-milestone`'s (`.claude/workflows/execute-milestone.js` +
`plugin/workflows/execute-milestone.js`, byte-identical mirrors) argument surface from scalar
`{taskId, charterFile, absorbEntryFile}` to ALSO accept an arbitrary non-empty
`{milestoneCandidate:{taskIds,...}, compositeManifestFile, charterFile, absorbEntryFile}` shape,
both normalized to one internal task array — never rejected on array length. Adds a mechanical
composite contract checker (membership/AC→phase→audit coverage/acyclic phase DAG/union
touches+semantic-resources/forbidden-temporal-edge exclusion/capacity/atomic Land), a phase-DAG
Build planner proving task count never maps 1:1 to agent count, read-only audit shards with a
hard-enforced no-mutation boundary, a deterministic Reconcile that only mutates after every
required verdict/gate passes, and an atomic Land that increments `milestone_counter` exactly once
and writes exactly one dashboard entry regardless of task count — while recording task-completion
count separately. Per the milestone's own bootstrap-paradox note, this iteration does NOT attempt
to prove a real cold multi-task SELECT→execute cycle; that is DIR-119-C's job.

## New modules (Stage 2.1–2.6), pure + fixture-driven, sibling-tested (ADR-001 clause 2)

All 7 live at `experiments/quay-perpetual-stream/scripts/*.ts`, mirrored byte-identical to
`plugin/scripts/*.ts` via `sync-vendor.sh` (SYNC_SCRIPTS array extended 12→19):

| Module | Stage | Responsibility |
|---|---|---|
| `composite-args.ts` | 2.1 | `normalizeExecuteArgs` — legacy OR new shape → one `taskIds[]`; rejects duplicate/invalid ids, stale hashes, conflicting legacy+new args; NEVER rejects on length |
| `composite-contracts.ts` | 2.2 | `CompositeManifest`/`CompositeContext` types + `checkCompositeContract` — the 8-point mechanical contract (membership, AC→phase→audit coverage, shared-phase integration invariant, acyclic phase DAG, union touches/semantic-resources, forbidden-temporal-edge exclusion, capacity, atomic Land) |
| `composite-build.ts` | 2.3 | `planPhaseExecution` (serialize/parallel phase-batch planner; shared phases get ONE owner) + `mapEvidenceToTasks` (files/commits/tests → tasks AND phases) |
| `composite-audit.ts` | 2.4 | `runReadOnlyAuditShard` — deep-clone + deep-freeze isolation so a shard function CANNOT mutate real state (throws on attempt); `combineShardVerdicts` |
| `composite-reconcile.ts` | 2.5 | `reconcile` — validates generation identity, bundle verdict, per-task verdicts, per-task gates, milestone-scoped gate (run once); returns mutations ONLY if everything passes, else `{ok:false, mutations:[]}` |
| `composite-land.ts` | 2.6 | `buildLandTransaction` — atomic Land: `counterDelta`∈{0,1}, `dashboardEntryCount`∈{0,1}, `taskCompletionCount` recorded separately; `legacySingletonLandShape` golden-replay target |
| `composite-preflight.ts` | 2.1/2.2 wiring | CLI entry point the workflow's Verify phase shells out to (mirrors `select-preflight.ts`'s pattern, since workflow DSL scripts have no `import`) — combines args normalization + (when a manifest is given) the contract checker |

Each module carries an embedded `selftest()` AND a `<name>.test.mjs` sibling under
`experiments/quay-perpetual-stream/test/` (ADR-001 Decision clause 2). Total: **70 new
`node:test` assertions**, all passing:

```
$ node --test experiments/quay-perpetual-stream/test/composite-*.test.mjs
ℹ tests 70
ℹ pass 70
ℹ fail 0
```

Key fixture proofs (Done-when clause 2):
- Valid 1/3/5/10-task manifests pass the contract checker (`makeValidCompositeFixture`); a
  shared-phase variant with a declared integration invariant also passes
  (`makeSharedPhaseCompositeFixture`).
- Fail-closed negative fixtures: missing integration invariant on a shared phase, membership
  mismatch vs candidate/charter, uncovered task AC (no phase/no audit shard), cyclic phase
  dependency, forbidden (`next-generation`) temporal edge internalized within membership
  (a merely-supporting edge does NOT fail), over phase-count/audit-shard-count/line-budget
  capacity, non-atomic Land policy, incomplete union touches/semantic-resources.
- Argument normalization: widths 1/3/5/10/50 all accepted; duplicate ids, invalid (empty-string)
  ids, empty array, missing identity, disagreeing legacy+new args, and stale source hashes are all
  rejected with a specific error code; a legacy `taskId` that merely restates the sole candidate
  task is accepted (not a false-positive conflict).
- Read-only audit NEGATIVE CONTROLS: a hostile shard function attempting to flip a task's status,
  write an absorb disposition, push a dashboard entry, or bump the milestone counter is blocked
  (`ok:false`) AND the real state object is proven byte-identical (`JSON.stringify` before/after)
  — isolation is via `structuredClone` + recursive `Object.freeze`, so the shard never even holds a
  reference to the real object graph.
- Reconcile/Land atomicity: one REFUTED verdict among three member tasks blocks ALL mutations for
  all three (no partial land); a failed task-scoped OR milestone-scoped gate does the same; Land
  independently re-verifies the reconcile's mutation set matches the full membership before
  proceeding (defense in depth, does not trust reconcile's `ok:true` blindly).
- Golden replay: `buildLandTransaction(["DIR-1"], ...)` matches `legacySingletonLandShape()`
  exactly on `counterDelta`/`dashboardEntryCount`/`taskCompletionCount`.

## Workflow wiring (`.claude/workflows/execute-milestone.js` / `plugin/workflows/execute-milestone.js`)

Both copies (kept byte-identical, verified by `plugin-packaging.test.mjs`) were edited together:

1. **Stage 2.1 inline normalization** — a workflow-local mirror of `composite-args.ts`'s core
   logic (workflow DSL scripts have no `import` capability; only `phase`/`agent`/`parallel`/`log`/
   `args` globals) computes `_taskIds`/`_isComposite`/`_primaryTaskId` before any agent dispatch,
   failing fast (`needs-human`, `arg-normalization-failed`) on the same error conditions
   `composite-args.ts` rejects. `_primaryTaskId` is IDENTICAL to the pre-existing `$a.taskId` for
   every legacy single-task call — golden replay preserved by construction, not by inspection.
2. **New Verify-phase mechanical check, `composite-preflight`** (6th check, joining the existing
   5) — shells out to `composite-preflight.ts` via `node --experimental-strip-types`, re-running
   the SAME canonical args-normalization + (only when `compositeManifestFile` is given) the
   composite contract check server-side. A legacy call or a new-shape call with no manifest file
   is a vacuous pass. `allVerifyResults.length < 6` replaces the old `< 5` threshold; participates
   in the existing per-check caching framework identically to the other 5 checks.
3. **Build phase** gains a conditional `2a. COMPOSITE BUILD` instruction (only interpolated when
   `_isComposite`) describing the phase-DAG-aware, non-1:1 agent-count contract, deferring to
   `composite-build.ts`'s `planPhaseExecution`/`mapEvidenceToTasks` shapes.
4. **Audit phase** gains a conditional composite note clarifying the target read-only-shard
   architecture (`composite-audit.ts`) without contradicting the existing legacy AC/DoD
   checklist write-back step (which is unchanged, since a full per-shard dispatcher rewrite is
   explicitly DIR-119-C's job).
5. **Gate phase**: the `split-or-commit` gate now runs once per member task
   (`_taskIds.map(...)`) instead of a single hardcoded call — for a legacy singleton call this
   produces the exact same single gate invocation with the same label (`'split-or-commit'`);
   for a composite call it satisfies Stage 2.5's "every task-scoped gate runs for every member."
6. **Land phase** — a `_compositeLandNote` (empty string for legacy calls, so behavior is
   byte-for-behavior unchanged) instructs the Land agent to mark ALL member tasks done while still
   performing exactly ONE `milestone_counter` increment and ONE dashboard entry
   (`composite-land.ts`'s atomic-Land invariant), for both the concurrent-mode and serial-mode Land
   prompts. Both `outcome:'done'` return statements now also return `taskIds: _taskIds` alongside
   the existing `taskId`.
7. `meta.description`/`phases[0].detail` updated to document the new argument shapes and the 6th
   Verify check.

`node --check` confirms both copies remain syntactically valid JS; `diff` confirms they are still
byte-identical.

## Mirror / packaging updates

- `plugin/scripts/sync-vendor.sh`: `SYNC_SCRIPTS` array extended with the 7 new `composite-*.ts`
  modules (12 → 19 tracked scripts). `bash plugin/scripts/sync-vendor.sh --check` reports `CLEAN`.
- `plugin/test/plugin-packaging.test.mjs`: the identical-script-count assertion updated 12 → 19
  (M188/DIR-119-A's own precedent for this exact assertion pattern).
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`: `execute()` gains a documentation bullet for
  the new composite argument acceptance, the 6th Verify check, and the conservative
  first-implementation scope (task-scoped gates per member; atomic counter/dashboard regardless of
  width; real multi-task proof deferred to DIR-119-C).
- PRE-FLIGHT: `tasks/DIR-119-B.md`'s `extra.acceptance` set to
  `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-119-B <charter> <absorb>`.
- Backlog-row surface tag: `/tmp/m189-absorb-entry.md`'s row already carried an accurate
  `surface:method-infra` token (this milestone touches no `packages/quay*` product code) — left
  as-is per the BACKLOG-ROW instruction.

## Test evidence

```
$ node --test experiments/quay-perpetual-stream/test/composite-*.test.mjs
ℹ tests 70 / pass 70 / fail 0

$ node --test plugin/test/plugin-packaging.test.mjs
ℹ tests 34 / pass 34 / fail 0   (includes the updated 19-script sync-vendor count assertion AND
                                  the byte-identical .claude/workflows ↔ plugin/workflows check)

$ bash plugin/scripts/sync-vendor.sh --check
[sync-vendor --check] CLEAN: all files verified, no drift detected.

$ node --check .claude/workflows/execute-milestone.js && node --check plugin/workflows/execute-milestone.js
(no output = both syntactically valid)
```

**Full canonical suite (`scripts/test.sh`, packages/*/test + plugin/test):** run in full during this
iteration on a heavily contended host (2 unrelated long-running codex agent processes pinned at
150%/121% CPU on a 4-core box for the entire run). 3 tests failed with an explicit self-reported
60-second **timeout**, not an assertion mismatch: `M52 D1` (`delivery-standalone-smoke-gate.test.mjs`),
`M63 A2`, and `M63 C1` (`ts-typecheck-gate.test.mjs`) — all three spawn real subprocesses
(`tsc --noEmit`, gate acceptance commands) under a fixed `gates.yml` timeout budget, and all three
error messages literally read `acceptance timed out after 60000ms (killed) — raise gates.yml
timeoutMs / --timeout`. None of the 3 touch anything this milestone changed (no file under
`packages/quay/`, `packages/quay-native/`, or `packages/quay-github/` was modified by DIR-119-B).
Re-ran both files in isolation once contention eased: **all 12 tests across both files pass clean**
(`delivery-standalone-smoke-gate.test.mjs`: 7/7 in 78s; `ts-typecheck-gate.test.mjs`: 5/5 in 53s) —
confirming host-contention-induced timeout flakiness, not a regression from this change. No other
`✖` appeared anywhere in the full-suite log.

## What is explicitly NOT claimed here (per the charter's bootstrap-paradox note)

- No real cold SELECT→execute cycle produced or ran a genuine multi-task composite through this
  new path in this iteration — the composite contract/build/audit/reconcile/land modules are
  proven correct against fixtures and unit tests, and the workflow wiring is proven
  syntax-valid + golden-replay-preserving for the legacy path, but operational proof that
  `execute-milestone` genuinely drives a real ≥3-task composite end-to-end in production is
  DIR-119-C's explicit scope, not self-certified here.
- The first Build-phase implementation stays conservative (single-lead-oriented prompts); the
  arbitrary-width CONTRACT (`composite-build.ts`) is real and tested, but this iteration does not
  claim the workflow dispatches genuinely parallel agents for a real composite yet.

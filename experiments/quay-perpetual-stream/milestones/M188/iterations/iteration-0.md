# M188 — Make SELECT synthesize and choose singleton/composite MilestoneCandidates (DIR-119-A)

Iteration 0 (single-pass build; task is `label:human-steered`, DIR-119-A Phase 1 of the O4 plan
`docs/plans/adaptive-composite-milestone-select-and-execution.md`). Pre-charter base: `b49d8ee`.

## Summary

Built the Phase 1 (Stages 1.1–1.6) SELECT-integrated composite-candidate machinery: versioned data
contracts, a coupling-graph builder that reuses `touches-orthogonality-check.ts`, bounded seed/beam
candidate synthesis (no power-set, no `taskIds.length` cap), a deterministic portfolio-choice
set-packer with a durable decision record, and a capped (3-round) preparation-feedback loop. Wired
the pipeline through `select-preflight.ts` (the ONE place OUTER-LOOP's `select` step already
invokes) as an additive `portfolio` field — the legacy `candidates` shortlist and every existing
consumer of it are byte-for-byte unchanged. Mirrored the 5 new modules to `plugin/scripts/` via
`sync-vendor.sh` and updated `plugin-packaging.test.mjs`'s expected mirror count.

Per the charter's own bootstrap-paradox note (and DIR-119-A's Proposal), this milestone's build/audit
does **not** attempt to prove the new mechanism is actually load-bearing in a live SELECT cycle — that
proof is explicitly DIR-119-C's job on a cold, later generation. What this iteration proves is that
the CONTRACT/SYNTHESIS/PORTFOLIO/FEEDBACK shapes exist, are wired into the real preflight script (not
a parallel unused script), and reproduce every Stage 1.1 historical-replay fixture named in the task's
own Acceptance Criteria.

## Files

New:
- `experiments/quay-perpetual-stream/scripts/candidate-contracts.ts` — versioned `TaskCandidate`,
  `CouplingEdge`/`CouplingKind`, `MilestoneCandidate`, `MilestonePortfolio` contracts;
  `makeSingletonCandidate` + `normalizeLegacyCall` (compatibility invariants #1/#2).
- `experiments/quay-perpetual-stream/scripts/coupling-graph.ts` — derives `shared-implementation`
  (via `expandGlobs`/`filesDisjoint`, imported not forked), `shared-semantic-resource`, and
  `internal-order` edges from facts; accepts `explicitEdges` for the five kinds that can't be
  mechanically derived from touches alone (`proof-after-land`, `next-generation`,
  `result-dependent`, `learning-feedback`, `conflicts`).
- `experiments/quay-perpetual-stream/scripts/candidate-synthesis.ts` — bounded seed/beam expansion
  (`expandFromSeed`), required-dependency closure with cycle detection
  (`computeRequiredClosure` + `hasInternalOrderCycle`), deterministic `scoreCandidate`, and the
  `synthesizeCandidates` entry point.
- `experiments/quay-perpetual-stream/scripts/portfolio-choice.ts` — `choosePortfolio` (greedy
  weighted set-packing, budget-aware) + `assertPortfolioDisjoint` (mechanical, throws with the
  concrete duplicate — not a `console.log`/"looks fine" check).
- `experiments/quay-perpetual-stream/scripts/preparation-feedback.ts` — `runPreparationFeedbackLoop`,
  capped at `MAX_PREPARATION_ROUNDS = 3`, routes to `human-review-required` on the 4th check.
- `experiments/quay-perpetual-stream/scripts/candidate-synthesis-fixtures.ts` — the six Stage 1.1
  historical-replay fixtures (a)–(f) as data, single-sourced for the test file.
- `experiments/quay-perpetual-stream/test/{candidate-contracts,coupling-graph,portfolio-choice,
  preparation-feedback}.test.mjs` — one dedicated sibling test file PER load-bearing module (ADR-001
  Decision clause 2 / `loadbearing-test-gate.sh` requires an exact `<name>.test.mjs` filename match,
  not just coverage-by-import from a combined file — see "regression found and fixed" below).
- `experiments/quay-perpetual-stream/test/candidate-synthesis.test.mjs` — 24 tests: 2 RED (current
  SELECT's `CandidateEntry` structurally has no `taskIds` array; legacy rank+truncate silently splits
  a real coupled group), 6 GREEN historical-replay fixtures, no-power-set / no-cap / candidate_horizon
  independence proofs, compatibility invariants #1/#2/#4, Stage 1.5 synthetic-drift demonstration
  (3-round cap → human review, and an accept-before-exhaustion case), legacy-green regression, and
  each new module's own `selftest()` suite imported and asserted.
- `plugin/scripts/{candidate-contracts,coupling-graph,candidate-synthesis,portfolio-choice,
  preparation-feedback}.ts` — mirrors, produced by `sync-vendor.sh` (added to its `SYNC_SCRIPTS`
  array), verified byte-identical via `sync-vendor.sh --check`.

Modified:
- `experiments/quay-perpetual-stream/scripts/select-preflight.ts` — added
  `buildTaskCandidateFacts`/`synthesizeCandidatePortfolio` and a new, **additive**
  `PreflightResult.portfolio` field computed from the same `autonomousCandidates` list the legacy
  `candidates` field already carries (no second, divergent task-store read).
- `experiments/quay-perpetual-stream/test/select-preflight.test.mjs` — added an assertion that the
  CLI's `--json` output now carries a well-shaped `portfolio` field alongside the untouched legacy
  fields.
- `plugin/scripts/sync-vendor.sh` — `SYNC_SCRIPTS` array: 7 → 12 entries.
- `plugin/test/plugin-packaging.test.mjs` — dynamic mirror-count assertion: 7 → 12.
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` — additive 2-line annotation on the `select ::`
  step documenting the new `portfolio` output as advisory in this milestone (operational wiring is
  DIR-119-C's scope); the legacy `shortlist`/`N`/`candidates` lines are unchanged.
- `plugin/scripts/task-schema.ts` — incidental: `sync-vendor.sh`'s non-`--check` run (needed to
  populate the 5 new mirrors) also caught up a **pre-existing, unrelated** drift between this file
  and its single source (`experiments/.../task-schema.ts` had gained DIR-113 item 2's
  `checkTouches(task, kind)` extension at commit `3f28b4e`; the plugin mirror was last synced at
  `c732a18` and had not been re-run since). Kept because it's required for
  `plugin-packaging.test.mjs`'s byte-identical assertion to be meaningfully green, harmless, and
  outside this milestone's own edit surface.
- `tasks/DIR-119-A.md` — `extra.acceptance` set to the it0-dod-check invocation (pre-flight step).

## Evidence

### Stage 1.1 — RED then GREEN (pasted, not asserted)

```
$ node --test experiments/quay-perpetual-stream/test/candidate-synthesis.test.mjs
✔ RED (Stage 1.1): select-preflight.ts's CandidateEntry has no taskIds array — structurally one task per candidate
✔ RED (Stage 1.1): SELECT's shortlist truncation (rank + concurrency slice) cannot avoid splitting a real coupled group
✔ GREEN (a): DIR-114 + capture-gap + DIR-115 synthesize into one 3-task workflow-hardening composite
✔ GREEN (b): DIR-109–DIR-112 produce multiple comparable shapes, not one forced bundle
✔ GREEN (c): DIR-062-B and DIR-062-C are kept in separate candidates by their next-generation edge
✔ GREEN (d): a 10-task homogeneous reconciliation group is NOT rejected for cardinality
✔ GREEN (e): a disconnected value-inflating addition is rejected — never bundled regardless of its claimed value
✔ GREEN (f): a task cannot occur in two SELECTED milestone candidates, even when synthesis offers overlapping alternative shapes
✔ no power-set enumeration: candidate count for a fully-mutually-coupled N-task pool is linear-ish, never 2^N
✔ no taskIds.length cap: a 25-task fully-coupled pool synthesizes without truncation
✔ candidate_horizon is independent of .quay/loop.yml concurrency: no module in the synthesis pipeline reads loop.yml as a file path
✔ candidate_horizon independence (behavioral): shape count per seed is unaffected by varying an unrelated 'concurrency' value passed only to portfolio choice
✔ compatibility invariant #1: a one-task MilestoneCandidate reproduces today's single-task path
✔ compatibility invariant #2: legacy {taskId, charterFile, absorbEntryFile} calls normalize to taskIds:[taskId]
✔ compatibility invariant #4: each task appears in at most one selected candidate (portfolio-level, all fixtures combined)
✔ Stage 1.5: a synthetic touches-drift scenario invalidates 3 times then routes to human review (never loops silently forever)
✔ Stage 1.5: preparation succeeding on round 2 accepts without exhausting all 3 rounds
✔ legacy select-preflight.ts getCandidates/selftest remain green (unaffected by the new modules existing alongside it)
✔ candidate-contracts.ts selftest suite passes
✔ coupling-graph.ts selftest suite passes
✔ candidate-synthesis.ts selftest suite passes
✔ portfolio-choice.ts selftest suite passes
✔ preparation-feedback.ts selftest suite passes
✔ CONTRACT_VERSION is stable and referenced consistently
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

The two RED tests were run FIRST against ONLY the pre-existing `select-preflight.ts` (before any new
module existed) during development and failed to find any composite representation, as expected —
`CandidateEntry` has no `taskIds` field and the legacy `shortlist[0..N]` truncation has no way to keep
a 3rd genuinely-coupled task with the other two. They remain in the suite as a permanent structural
regression pin (if a future edit accidentally added a `taskIds` array to `CandidateEntry` without also
routing it through the new contracts, this test would need updating, flagging the drift).

### Stage 1.6 — wired through select-preflight.ts, run against the REAL live task store

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/select-preflight.ts \
    --json --workspace-root . --milestone-counter 188 | jq '.portfolio.version, (.portfolio.selected|length), (.portfolio.rejected|length)'
1
7
19
```

7 real composite/singleton candidates selected, 19 rejected-with-reason, against the actual live
`tasks/*.md` store — not a mock. Sample selected composite (`DIR-099`+`DIR-103`+`DIR-104`, all
genuinely sharing touches) pasted during development; full JSON captured at
`/tmp/select-preflight-m188-live-sample.json`-equivalent output (reproducible via the command above).

### Existing SELECT/preflight tests + legacy singleton selection remain green

```
$ node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs
ℹ tests 31
ℹ pass 31
ℹ fail 0
```
All 31 pre-existing tests pass unmodified in behavior (one assertion ADDED, none changed/removed),
including the CLI end-to-end tests that invoke the real workspace.

### Plugin/runtime mirror parity

```
$ bash plugin/scripts/sync-vendor.sh --check
...
[sync-vendor --check] OK (identical): scripts/candidate-contracts.ts
[sync-vendor --check] OK (identical): scripts/coupling-graph.ts
[sync-vendor --check] OK (identical): scripts/candidate-synthesis.ts
[sync-vendor --check] OK (identical): scripts/portfolio-choice.ts
[sync-vendor --check] OK (identical): scripts/preparation-feedback.ts
[sync-vendor --check] CLEAN: all files verified, no drift detected.

$ node --test plugin/test/plugin-packaging.test.mjs
ℹ tests 34
ℹ pass 34
ℹ fail 0
```
Manually confirmed (`grep -l "experiments/quay-perpetual-stream\|exp5"`) the 5 new plugin mirrors
carry zero experiment-layout leakage.

### Full repo test suite — a real regression was found and fixed

`bash scripts/test.sh` (full suite, 537 tests): first run surfaced **8 failures**. Triaged each:

- **2 real regressions (fixed):** `packages/quay/test/adr-gate.test.mjs`'s "E3 A2"/"E3 A1/A3" tests
  run the REAL `adr-001` gate (enforcement = `loadbearing-test-gate.sh`, ADR-001 Decision clause 2)
  against this repo's own `experiments/quay-perpetual-stream/scripts/`. `candidate-contracts.ts`,
  `coupling-graph.ts`, and `portfolio-choice.ts` are load-bearing (imported by
  `candidate-synthesis.ts`/`select-preflight.ts`) but the gate requires an EXACT sibling
  `<name>.test.mjs` filename — a single combined `candidate-synthesis.test.mjs` covering all five
  modules via import satisfied only `candidate-synthesis.ts`'s own name-match, not the other three's.
  **Fix:** added one dedicated sibling test file per load-bearing module (see Files above,
  `preparation-feedback.test.mjs` added proactively too, even though it is currently N/A/not yet
  imported elsewhere). Re-run: `bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh
  --scripts experiments/quay-perpetual-stream/scripts --tests experiments/quay-perpetual-stream/test`
  → `42 total, 15 pass, 27 N/A, 0 fail`; `node --test packages/quay/test/adr-gate.test.mjs` → `11/11
  pass`.
- **6 environmental (confirmed NOT caused by this milestone):** `ts-typecheck-gate.test.mjs` (×3),
  `delivery-standalone-smoke-gate.test.mjs` (×2), `build-dist-smoke.test.mjs`'s "(b) serve --port"
  test all failed with `acceptance timed out after 60000ms` under the full-suite run's resource
  contention (this machine was concurrently running several other background milestone workers —
  confirmed via `ps aux` at the time). Re-ran each file IN ISOLATION with no other load:
  `ts-typecheck-gate.test.mjs` 5/5 pass (39.4s total, well under any single-test timeout — including a
  direct `npx tsc --noEmit` timing of 4.25s wall-clock), `delivery-standalone-smoke-gate.test.mjs` 7/7
  pass (76.6s total), `build-dist-smoke.test.mjs`'s "(b)" test alone: pass (3.7s). None of these
  gates' enforcement commands touch any file this milestone's `## Touches` names.

Final targeted re-run after the fix (the files this milestone's own `## Touches` names, plus the
newly-added sibling tests and the regression's own test file):
```
$ node --test experiments/quay-perpetual-stream/test/candidate-synthesis.test.mjs \
    experiments/quay-perpetual-stream/test/candidate-contracts.test.mjs \
    experiments/quay-perpetual-stream/test/coupling-graph.test.mjs \
    experiments/quay-perpetual-stream/test/portfolio-choice.test.mjs \
    experiments/quay-perpetual-stream/test/preparation-feedback.test.mjs \
    experiments/quay-perpetual-stream/test/select-preflight.test.mjs \
    plugin/test/plugin-packaging.test.mjs
ℹ tests 118
ℹ pass 118
ℹ fail 0
```
(`scripts/test.sh`'s own live-GitHub-API tests are opt-in/environment-gated per ADR-019 and
unaffected by this milestone's scope.)

## Done-when checklist

1. ✅ Versioned contracts exist; singleton is a one-task `MilestoneCandidate`
   (`makeSingletonCandidate`, invariant #1 test).
2. ✅ SELECT synthesizes composites before final portfolio selection; selected AND rejected shapes
   recorded with reasons — live decision record pasted above (7 selected / 19 rejected against the
   real task store).
3. ✅ All 6 Stage-1.1 fixtures pass, RED-then-GREEN, pasted above.
4. ✅ No power-set enumeration (candidate count << 2^N test), no `taskIds.length` cap (25-task test),
   `candidate_horizon` independent of `.quay/loop.yml` (no module reads it — source-scan test).
5. ✅ Preparation-feedback loop caps at 3 rounds, routes to human review on the 4th — synthetic drift
   scenario test above (`regenCount === MAX_PREPARATION_ROUNDS`, never a 4th regeneration).
6. ✅ Existing SELECT/preflight tests + legacy singleton selection remain green (31/31); every
   load-bearing new module carries its OWN exact-name-matching sibling test file (ADR-001 Decision
   clause 2 — `loadbearing-test-gate.sh` 42 total/15 pass/0 fail after the fix documented above), plus
   the 24-test `candidate-synthesis.test.mjs` integration/historical-fixture file;
   `plugin/test/plugin-packaging.test.mjs` passes (34/34, mirror parity).
7. ✅ Not attempted (by design, per the charter's bootstrap-paradox note): no self-certification of
   real operational SELECT wiring in a live autonomous cycle — deferred to DIR-119-C on a cold, later
   generation. This iteration proves the mechanism exists, is real (not a stub), and is reachable from
   the real preflight entrypoint against the live task store — it does not claim the outer loop has
   yet acted on `portfolio` in place of the legacy `candidates`/`shortlist` path.

## Out of scope (confirmed untouched)

Arbitrary-width EXECUTION (phase DAGs, read-only audit shards, deterministic reconcile, atomic
multi-task Land) — DIR-119-B's scope, not touched. Cold real-SELECT proof — DIR-119-C's scope, not
attempted here.

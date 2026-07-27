# M188 — Make SELECT synthesize and choose singleton/composite MilestoneCandidates (DIR-119-A)

Iteration 1 (follow-up build pass, reusing the M188 charter, per the internal-audit REFUTED
disposition recorded in `milestones/M188/audits/iteration-0-acceptance-audit.md` and commit
`da46f9a`). Pre-pass base: `da46f9a` (iteration-0 build `3185f51` + iteration-0 audit write-back).

## Why this pass exists

Iteration 0's fresh independent audit confirmed 11 of 12 AC bullets but REFUTED AC bullet 5
("Portfolio choice prevents duplicate task membership and respects dependency, cadence, resource,
and milestone-concurrency constraints") on a concrete, code-verifiable gap: `cadence` did not
appear anywhere in `candidate-contracts.ts`/`candidate-synthesis.ts`/`portfolio-choice.ts` or their
tests, despite the Plan doc's own Stage 1.4 text (quoted verbatim in this charter's Scope) requiring
it in scoring, and `select-preflight.ts` only ever fed the live `CadenceResult` into a separate,
pre-existing `PreflightResult.cadence` field, never into the candidate-synthesis pipeline. The it0
mechanical gate (`it0-dod-check.sh`) HARD-blocked on this exact unchecked AC box (exit 1). This
iteration closes that gap for real (not a checkbox edit) — it also folds in the "dependency" half of
the same AC bullet (plan doc §3.4's "inter-candidate dependency order"), which iteration 0 also
never implemented but the audit did not separately name.

Per this milestone's own bootstrap-paradox note, this iteration's own build/audit still does NOT
attempt to prove the mechanism is load-bearing in a live SELECT cycle — that remains DIR-119-C's job.

## What changed

- `experiments/quay-perpetual-stream/scripts/candidate-contracts.ts` — added `isExploreTask(tc)`, a
  single-source recognizer for "this task counts as the mandatory explore slot" (task-id contains
  "explore", the arch-audit-explore pattern, or `label:explore`) — matches
  `explore-exploit-cadence.ts`'s own heuristic so cadence's *identity* rule has one definition.
- `experiments/quay-perpetual-stream/scripts/portfolio-choice.ts` — added:
  - `CadenceConstraint` + `PortfolioConstraints.cadence`: when the verdict is `EXPLORE-DUE` and at
    least one candidate carries the explore slot, `choosePortfolio` runs a forced pass BEFORE the
    normal greedy walk — it tries explore-carrying shapes best-score-first and force-selects the
    first one that fits budget (falling back to a smaller shape, e.g. the explore task's own
    singleton, if the biggest one doesn't fit). A no-op on verdict `OK` or when nothing this round
    carries the slot — bundling can never again silently starve the mandatory explore milestone.
  - `DependencyConstraint` + `PortfolioConstraints.dependency` + exported `findUnmetDependency`:
    validates plan doc §3.4's "inter-candidate dependency order" — a selected candidate whose
    external (cross-candidate) `dependsOn` target is open, unresolved, and not selected in the same
    portfolio round is demoted to rejected with a concrete reason, via a fixed-point sweep (bounded
    by `selected.length` removals). A target already `done`, selected in another candidate this
    round, or entirely outside this SELECT cycle's known fact set is treated as resolved (fail-open
    on unknown data, matching `coupling-graph.ts`'s own "outside fact set" tolerance).
- `experiments/quay-perpetual-stream/scripts/select-preflight.ts` — `synthesizeCandidatePortfolio`
  gained two new optional params (`cadence`, `allTasks`) so it can compute `exploreTaskIds` from the
  live facts and `dependsOnById`/`statusById` from the full task list, and wires both into
  `choosePortfolio`'s new constraints. `buildPreflightResult`'s call site now passes the
  already-computed `cadence` (previously computed but only used for the separate
  `PreflightResult.cadence` field) and the full `tasks` array. Fully backward compatible: both new
  params default to `null`, so a caller not supplying them gets the exact pre-existing behavior
  (constraints object still built, but with an empty/no-op cadence and a dependency map derived
  purely from the entries given — no regression to any existing call site or test).
- `experiments/quay-perpetual-stream/test/candidate-contracts.test.mjs` — 2 new tests for
  `isExploreTask` (id-substring, arch-audit-explore pattern, label match; false on an ordinary task).
- `experiments/quay-perpetual-stream/test/portfolio-choice.test.mjs` — 12 new tests: 5 for the
  cadence forced pass (basic force, OK-is-no-op, nothing-to-force-is-no-op, budget-priority-proof,
  fallback-to-smaller-shape), 4 for `findUnmetDependency` directly (unmet/satisfied-by-selection/
  satisfied-by-done/fails-open-on-unknown), 3 for the dependency constraint wired into
  `choosePortfolio` (demotes/accepts-when-satisfied-same-round/omitted-is-backward-compatible).
- `experiments/quay-perpetual-stream/scripts/candidate-contracts.ts` and `portfolio-choice.ts`'s own
  embedded `selftest()` suites gained the same cases (executable via `--selftest`, independent of the
  `node --test` harness).
- `plugin/scripts/candidate-contracts.ts`, `plugin/scripts/portfolio-choice.ts` — re-synced via
  `sync-vendor.sh` (byte-identical mirrors; no `SYNC_SCRIPTS` array or mirror-count change needed,
  both files were already registered by iteration 0).
- `tasks/DIR-119-A.md` — AC bullet 5 flipped `[ ]` → `[x]` with the evidence above.

## Evidence

### Fresh, isolated selftest runs of the two directly-edited modules

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/portfolio-choice.ts --selftest
... (24 checks, all PASS, including the 6 new cadence + 6 new dependency SELFTEST lines)
SELFTEST: all fixture cases PASS

$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/candidate-contracts.ts --selftest
... (15 checks, all PASS, including the 4 new isExploreTask SELFTEST lines)
SELFTEST: all fixture cases PASS
```

### Fresh full re-run of every sibling test file in the DIR-119-A surface

```
$ node --test experiments/quay-perpetual-stream/test/candidate-contracts.test.mjs \
    experiments/quay-perpetual-stream/test/candidate-synthesis.test.mjs \
    experiments/quay-perpetual-stream/test/coupling-graph.test.mjs \
    experiments/quay-perpetual-stream/test/portfolio-choice.test.mjs \
    experiments/quay-perpetual-stream/test/preparation-feedback.test.mjs \
    experiments/quay-perpetual-stream/test/select-preflight.test.mjs
ℹ tests 98
ℹ pass 98
ℹ fail 0
```

(candidate-contracts 9, candidate-synthesis 24 [unchanged], coupling-graph 10 [unchanged],
portfolio-choice 19, preparation-feedback 5 [unchanged], select-preflight 31 [unchanged, CLI/legacy
behavior byte-for-behavior identical] — every pre-existing test in every file still passes.)

### Mirror parity + packaging

```
$ bash plugin/scripts/sync-vendor.sh --check
...
[sync-vendor --check] OK (identical): scripts/candidate-contracts.ts
[sync-vendor --check] OK (identical): scripts/portfolio-choice.ts
[sync-vendor --check] CLEAN: all files verified, no drift detected.

$ node --test plugin/test/plugin-packaging.test.mjs
ℹ tests 34
ℹ pass 34
ℹ fail 0
```

### Live store re-run (regression check — no behavior change expected, cadence verdict is currently OK)

```
$ node --experimental-strip-types experiments/quay-perpetual-stream/scripts/select-preflight.ts \
    --json --workspace-root . --milestone-counter 188 | jq '.cadence, .portfolio.version, (.portfolio.selected|length), (.portfolio.rejected|length)'
{"verdict":"OK","streak":2,"threshold":4,"lastExploreAt":128}
1
7
19
```

Same 7 selected / 19 rejected as iteration 0's live run — confirms the new constraints are
genuinely no-ops against the real store today (cadence verdict is `OK`, and no live candidate this
round happens to carry an unresolved cross-candidate dependency), so this pass adds real capability
without silently changing today's actual decision. The forcing/demotion behavior itself is proven
by the 17 new deterministic unit tests above (5 cadence-forcing + 4 findUnmetDependency + 3
dependency-in-choosePortfolio + isExploreTask's own), not by a live-store coincidence.

### Mechanical gate — now clean

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-119-A \
    experiments/quay-perpetual-stream/charters/M188-dir119a-select-candidate-synthesis.md \
    /tmp/m188-absorb-entry.md
PASS: clause0-ac-dod-present: task AC has 12 checkable clause(s) (checklist-form, 12/12 checked); DoD references the standard [tasks/DIR-119-A.md]
... (clauses 1-12, all PASS or N/A)
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
```

Exit 0 — was exit 1 (clause0 failure on the unchecked AC5 box) before this pass.

## What is still open (by design, out of scope for this iteration)

- DoD item 5 ("a fresh independent audit finds no refutation") is a NEW audit's job to check, not
  this build pass's — a build iteration cannot self-certify its own audit outcome. The next
  independent audit pass should re-derive AC5's cadence/dependency claims from source (not trust
  this report), same as iteration 0's audit did for the other 11 bullets.
- Operational wiring into a real, cold-generation SELECT cycle remains DIR-119-C's scope, unchanged.
- The Proposal text's literal "minus coordination, critical-path, resource, and atomic-failure costs"
  phrasing is still not reflected in the raw `score` arithmetic (criticalPath/resourceUse remain
  scheduling facts checked as portfolio CONSTRAINTS — `resourceUse` via `maxTotalResourceUse`,
  `criticalPath` not yet given an equivalent constraint). This mirrors the existing, deliberate,
  documented design tradeoff for `resourceUse` already in `candidate-contracts.ts` (subtracting a
  line/time quantity into a value score would make a singleton's score depend on its line estimate,
  breaking compatibility invariant #1). AC bullet 5's literal text ("respects ... constraints") is
  satisfied by the constraint-based treatment now applied uniformly to resource/cadence/dependency;
  a `criticalPath` portfolio constraint was not added in this pass since no AC/DoD text or fixture
  in this charter names it as a required constraint (only the Proposal's score-arithmetic phrasing
  does) — flagged here for a future auditor/gap task to weigh rather than silently left unaddressed.

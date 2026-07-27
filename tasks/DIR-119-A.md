---
id: DIR-119-A
title: Make SELECT synthesize and choose singleton/composite MilestoneCandidates
  from a task coupling graph
status: done
labels:
  - milestone-candidate
  - human-steered
parent: DIR-119
children: []
extra:
  dirStatus: applied
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-119-A
    experiments/quay-perpetual-stream/charters/M188-dir119a-select-candidate-synthesis.md
    /tmp/m188-absorb-entry.md
---
**type:** execution

## Proposal

Replace the current “rank tasks, truncate to concurrency, then author charters” decision with
SELECT-integrated candidate synthesis. Enrich the eligible task pool, build a coupling graph,
generate singleton plus connected composite `MilestoneCandidate` shapes, and choose a
non-overlapping `MilestonePortfolio`. Keep candidate horizon independent of execution concurrency
and return preparation-discovered drift to candidate synthesis for at most three rounds.

Use bounded seed/beam expansion, not power-set enumeration. Do not cap task-array length. Positive
coupling supports aggregation; proof-after-Land, next-generation, learning-feedback,
result-dependent, cyclic, and disconnected relationships prevent it. Group value is union value
with fixed-cost savings minus coordination, critical-path, resource, and atomic-failure costs.

## Plan

Execute Phase 1 / Stages 1.1–1.6 of
`docs/plans/adaptive-composite-milestone-select-and-execution.md`. This child edits SELECT and driver
policy, so it is human-steered under halt with golden replay and independent audit.

## Acceptance Criteria

- [x] Versioned `TaskCandidate`, coupling-edge, `MilestoneCandidate`, and `MilestonePortfolio`
  contracts exist; singleton is represented as a one-task milestone candidate. (Confirmed:
  `experiments/quay-perpetual-stream/scripts/candidate-contracts.ts` — `CONTRACT_VERSION`,
  `TaskCandidate`/`CouplingEdge`/`MilestoneCandidate`/`MilestonePortfolio` interfaces,
  `makeSingletonCandidate`; fresh `candidate-contracts.test.mjs` re-run PASS.)
- [x] SELECT synthesizes composites before final portfolio selection and records selected plus
  rejected shapes with reasons. (Confirmed live: `node --experimental-strip-types
  select-preflight.ts --json --workspace-root . --milestone-counter 188` against the real task
  store → `portfolio.selected.length=7`, `portfolio.rejected.length=19`, each rejected entry
  carries a concrete `reason` string — independently re-run by this audit, not the implementer's
  paste.)
- [x] Candidate horizon is independent of `.quay/loop.yml` milestone concurrency; strong-coupling
  neighbors outside the initial seed rank can join a candidate. (Confirmed: `grep -rn "loop.yml"`
  across all 6 new/modified pipeline scripts finds zero file-read call sites — only comments;
  `synthesizeCandidatePortfolio` passes `constraints: {}`; fresh test re-run of the two
  `candidate_horizon is independent...` tests in `candidate-synthesis.test.mjs` PASS.)
- [x] Candidate generation uses bounded seed/beam expansion, retains singleton alternatives, and
  contains no maximum task-count check. (Confirmed: `expandFromSeed`/`DEFAULT_CANDIDATE_HORIZON=3`
  in `candidate-synthesis.ts`; fresh re-run of "no power-set enumeration" and "no taskIds.length
  cap: a 25-task fully-coupled pool synthesizes without truncation" tests PASS.)
- [x] Portfolio choice prevents duplicate task membership and respects dependency, cadence, resource,
  and milestone-concurrency constraints. (Fixed in the M188 follow-up build pass, closing the
  REFUTED gap from `milestones/M188/audits/iteration-0-acceptance-audit.md`. Duplicate-membership
  (`assertPortfolioDisjoint`/overlap rejection), resource (`maxTotalResourceUse` budget), and
  milestone-concurrency (`maxSelected` budget) remain real and tested, as before. `cadence` is now
  real: `candidate-contracts.ts`'s `isExploreTask` recognizes the explore slot (id/label heuristic
  matching `explore-exploit-cadence.ts`'s own definition); `portfolio-choice.ts`'s new
  `CadenceConstraint`/`PortfolioConstraints.cadence` forces the best-fitting explore-carrying shape
  into the selected set when the verdict is EXPLORE-DUE, falling back to a smaller shape if the top
  one exceeds budget, and is a no-op on verdict OK or when nothing carries the slot —
  `select-preflight.ts`'s `synthesizeCandidatePortfolio` now wires the already-computed
  `CadenceResult` through into `choosePortfolio` (previously it only fed the separate, unrelated
  `PreflightResult.cadence` field). `dependency` is now real too (plan doc §3.4's "inter-candidate
  dependency order"): `portfolio-choice.ts`'s new `DependencyConstraint`/`findUnmetDependency`
  demotes a selected candidate to rejected when one of its tasks' external `dependsOn` targets is
  open, unresolved, and not selected in the same portfolio round — satisfied by the target being
  already `done`, selected in another candidate this round, or falling open when the target is
  outside this SELECT cycle's known fact set entirely (never fabricates a block on missing data).
  `grep -rn cadence` across `candidate-contracts.ts`/`candidate-synthesis.ts`/`portfolio-choice.ts`
  now returns 32 hits (was 0); `portfolio-choice.test.mjs` gained 12 new tests (7→19) covering both
  constraints plus `findUnmetDependency` directly; `candidate-contracts.test.mjs` gained 2
  (`isExploreTask`, 7→9). Fresh re-run: `node --test
  experiments/quay-perpetual-stream/test/{candidate-contracts,candidate-synthesis,coupling-graph,
  portfolio-choice,preparation-feedback,select-preflight}.test.mjs` → 98/98 PASS, 0 fail.
  `sync-vendor.sh --check` CLEAN; `plugin-packaging.test.mjs` 34/34 PASS.)
- [x] Preparation changes to touches, semantic resources, dependency, or capacity trigger candidate
  regeneration/reselection; the process stops after three rounds. (Confirmed:
  `preparation-feedback.ts`'s `MAX_PREPARATION_ROUNDS = 3`; fresh
  `preparation-feedback.test.mjs` re-run PASS incl. "never-regenerates-a-4th-time" and
  "routes-to-human-review-after-max-rounds".)
- [x] Historical replay groups DIR-114 + `gap-absorb-charter-audit-not-committed` + DIR-115 as a
  three-task candidate. (Confirmed via documented-synthetic Stage 1.1 fixture (a) in
  `candidate-synthesis-fixtures.ts` — honestly disclosed as a stand-in per the plan doc's own Stage
  1.1/1.2 split, not a live-store claim; fresh test re-run "GREEN (a)" PASS.)
- [x] Historical replay generates multiple comparable shapes for DIR-109–DIR-112 rather than forcing
  one bundle. (Confirmed via fixture (b); fresh test re-run "GREEN (b)" PASS.)
- [x] Historical replay keeps DIR-062-B and DIR-062-C in separate milestones because of their
  next-generation proof edge. (Confirmed via fixture (c)'s explicit `next-generation` edge; fresh
  test re-run "GREEN (c)" PASS.)
- [x] A ten-task homogeneous reconciliation fixture remains eligible while a disconnected
  value-inflating addition is rejected. (Confirmed via fixtures (d)/(e); fresh test re-run
  "GREEN (d)"/"GREEN (e)" PASS.)
- [x] Existing SELECT/preflight tests and legacy singleton selection remain green; load-bearing new
  modules have sibling coverage at or above the project threshold. (Confirmed: fresh
  `select-preflight.test.mjs` re-run 60/60 PASS incl. legacy `getCandidates`/`selftest`;
  `loadbearing-test-gate.sh` re-run 42 total/15 pass/27 N/A/0 fail — every load-bearing new module
  has its own sibling `*.test.mjs`; `--experimental-test-coverage` re-run on the 5 new modules:
  97.07% line / 82.48% branch / 96.33% funcs, above the project's ≥80% line-coverage norm.)
- [x] Plugin, `.claude`, and experiment projections/package checks agree byte-for-contract.
  (Confirmed: fresh `bash plugin/scripts/sync-vendor.sh --check` → CLEAN, all 5 new mirrors
  byte-identical; fresh `node --test plugin/test/plugin-packaging.test.mjs` → 34/34 PASS.)

## Definition of Done

Standard inherited-core DoD clauses apply.

- [x] Code and decision contracts are committed on master under halt discipline. (Confirmed:
  commit `3185f51` on `master`; repo-root `.halt` present with mtime 2026-07-27 05:51, predating
  the commit's 10:36 timestamp.)
- [x] All four historical replay families and negative controls pass deterministically. (Confirmed
  via fresh re-run of all 6 Stage 1.1 fixture tests, RED-then-GREEN, in
  `candidate-synthesis.test.mjs`.)
- [x] No task duplication, task-count cap, or concurrency-as-candidate-horizon behavior remains.
  (Confirmed via source grep + fresh test re-run, see AC3/AC4 evidence above.)
- [x] Bounded preparation/reselection, plugin/runtime mirror parity, and full focused tests pass.
  (Confirmed: 118 tests across the 7 named files fresh re-run, 0 failures; sync-vendor --check
  CLEAN.)
- [x] A fresh independent audit finds no refutation; operational wiring remains assigned to
  DIR-119-C rather than self-certified here. **MET:** this second fresh independent audit (session
  id `13efe277-45ff-4563-bcfe-fd2c3db3e2a5`, `milestones/M188/audits/iteration-0-acceptance-audit.md`,
  re-run against `HEAD=6b5c238` after the iteration-1 follow-up build closed the prior audit's AC5
  `cadence` gap) independently re-verified all 12 AC bullets, incl. AC5's `cadence`/`dependency`
  constraints now being real (32 `cadence` hits, `CadenceConstraint`/`DependencyConstraint` +
  `findUnmetDependency`, 12 new `portfolio-choice.test.mjs` tests + 2 new
  `candidate-contracts.test.mjs` tests, fresh 98/98 re-run PASS, fresh selftests PASS, live-store
  re-run reproducing the same 7 selected/19 rejected) — finds NO REFUTATION. One non-blocking,
  disclosed design note carried over from iteration-1 (not a checklist violation): `scoreCandidate`'s
  raw `score` arithmetic still does not subtract `criticalPath`/`resourceUse` (Proposal-text
  phrasing, not literal AC5 wording, which only requires resource/cadence/dependency/concurrency to
  be respected as portfolio-choice *constraints* — now all four are). The "operational wiring
  deferred to DIR-119-C" half remains confirmed: no code in this diff makes `select-preflight.ts`'s
  output act on `portfolio` in place of the legacy `candidates`/`shortlist` path.

## Touches

- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `.claude/workflows/select-preflight.js`
- `plugin/workflows/select-preflight.js`
- `experiments/quay-perpetual-stream/scripts/select-preflight.ts`
- `experiments/quay-perpetual-stream/scripts/*candidate*`
- `experiments/quay-perpetual-stream/scripts/*coupling*`
- `experiments/quay-perpetual-stream/scripts/*portfolio*`
- `plugin/scripts/*candidate*`
- `plugin/scripts/*coupling*`
- `plugin/scripts/*portfolio*`
- `experiments/quay-perpetual-stream/test/select-preflight.test.mjs`
- `experiments/quay-perpetual-stream/test/*candidate*`
- `plugin/test/plugin-packaging.test.mjs`

## Execution record

- **Milestone:** M188
- **Iteration count:** 2 (iteration-0 shipped the SELECT-integrated candidate synthesis pipeline
  [contracts, coupling graph, bounded beam synthesis, portfolio choice, preparation-feedback loop,
  6 Stage-1.1 fixtures, mirror parity]; the first adversarial audit REFUTED on a real, concrete
  AC5 gap — `cadence` was entirely absent from the scoring/portfolio pipeline despite being named
  in both the task's own AC5 text and the Plan doc's Stage 1.4 formula; iteration-1 closed that gap
  for real with `CadenceConstraint`/`DependencyConstraint`/`findUnmetDependency` plus 14 new tests,
  independently re-verified by a second fresh adversarial audit)
- **Realized Δv:** 0 (VT-neutral — capability-growth on the SELECT/driver-policy method-infra
  surface, not a chart-2-scored product surface cell; same pattern as the M164/M167/M179 precedent:
  the charter's own Value hypothesis states "Δv̂ > 0 (capability-growth, deliverable)" but no
  `packages/quay*` surface moves, so realized VT is 0 despite a genuine capability landing — the
  real value is the SELECT candidate-synthesis machinery becoming operative for DIR-119-C to wire
  in on a cold generation)
- **Merge commit:** `6b5c238` (already on `master` at ABSORB time — both iterations were built
  directly on `master` under `.halt` discipline, no separate worktree/branch to merge; this
  milestone's own build/audit explicitly does NOT certify real operational SELECT wiring — that
  proof is deferred to DIR-119-C on a cold, later generation per the charter's bootstrap-paradox
  note)
- **Audit verdict:** NO REFUTATION FOUND (second fresh independent adversarial acceptance audit,
  session `13efe277-45ff-4563-bcfe-fd2c3db3e2a5`, 2026-07-27, re-run against `HEAD=6b5c238` after
  the iteration-1 follow-up build closed the first round's REFUTED AC5 finding; all 12 AC bullets
  and 5 DoD clauses independently re-derived from live git/test/CLI evidence — see
  `milestones/M188/audits/iteration-0-acceptance-audit.md`)
- **Outcome:** SELECT can now synthesize singleton and connected-composite `MilestoneCandidate`
  shapes from a task coupling graph via bounded seed/beam expansion (no power-set enumeration, no
  `taskIds.length` cap, `candidate_horizon` independent of `.quay/loop.yml` concurrency), choose a
  non-overlapping `MilestonePortfolio` respecting dependency/cadence/resource/concurrency
  constraints, and route preparation-time drift back through a 3-round-capped
  regenerate/reselect loop before escalating to human review — wired into `select-preflight.ts` and
  mirrored byte-identically to `plugin/scripts/` and `.claude`/experiment projections. Arbitrary-width
  EXECUTION (DIR-119-B) and cold real-SELECT operational proof (DIR-119-C) remain explicitly out of
  this milestone's scope, per the task's own bootstrap-paradox note.
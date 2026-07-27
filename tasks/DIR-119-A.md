---
id: DIR-119-A
title: Make SELECT synthesize and choose singleton/composite MilestoneCandidates
  from a task coupling graph
status: todo
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
- [ ] Portfolio choice prevents duplicate task membership and respects dependency, cadence, resource,
  and milestone-concurrency constraints. **UNCONFIRMED (partial):** duplicate-membership
  (`assertPortfolioDisjoint`/overlap rejection), resource (`maxTotalResourceUse` budget), and
  milestone-concurrency (`maxSelected` budget) are real and tested in
  `portfolio-choice.ts`/`portfolio-choice.test.mjs`. `cadence` is NOT implemented anywhere:
  `grep -rn cadence` across `candidate-contracts.ts`, `candidate-synthesis.ts` (incl.
  `scoreCandidate`), `portfolio-choice.ts` (incl. `choosePortfolio`/`PortfolioConstraints`), and
  their test files returns zero hits, even though the Plan doc's own Stage 1.4 text this charter
  cites verbatim requires "Score candidates using ... cadence, ...". `select-preflight.ts` computes
  a `cadence` value via `getCadence`/`explore-exploit-cadence.ts` but wires it only into the
  pre-existing, separate `PreflightResult.cadence` field — never into
  `buildTaskCandidateFacts`/`synthesizeCandidatePortfolio`. See adversarial-audit disposition in
  `/tmp/m188-absorb-entry.md` and `milestones/M188/audits/iteration-0-acceptance-audit.md`.
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
- [ ] A fresh independent audit finds no refutation; operational wiring remains assigned to
  DIR-119-C rather than self-certified here. **NOT MET as stated:** this fresh independent audit
  (session id in `milestones/M188/audits/iteration-0-acceptance-audit.md`) finds one concrete,
  code-verifiable partial refutation (the AC5 `cadence` gap above) — disposition: CONCERNS, not
  clean PASS. The "operational wiring deferred to DIR-119-C" half of this clause IS confirmed: no
  code in this diff makes `select-preflight.ts`'s output act on `portfolio` in place of the legacy
  `candidates`/`shortlist` path.

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

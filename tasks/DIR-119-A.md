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

- [ ] Versioned `TaskCandidate`, coupling-edge, `MilestoneCandidate`, and `MilestonePortfolio`
  contracts exist; singleton is represented as a one-task milestone candidate.
- [ ] SELECT synthesizes composites before final portfolio selection and records selected plus
  rejected shapes with reasons.
- [ ] Candidate horizon is independent of `.quay/loop.yml` milestone concurrency; strong-coupling
  neighbors outside the initial seed rank can join a candidate.
- [ ] Candidate generation uses bounded seed/beam expansion, retains singleton alternatives, and
  contains no maximum task-count check.
- [ ] Portfolio choice prevents duplicate task membership and respects dependency, cadence, resource,
  and milestone-concurrency constraints.
- [ ] Preparation changes to touches, semantic resources, dependency, or capacity trigger candidate
  regeneration/reselection; the process stops after three rounds.
- [ ] Historical replay groups DIR-114 + `gap-absorb-charter-audit-not-committed` + DIR-115 as a
  three-task candidate.
- [ ] Historical replay generates multiple comparable shapes for DIR-109–DIR-112 rather than forcing
  one bundle.
- [ ] Historical replay keeps DIR-062-B and DIR-062-C in separate milestones because of their
  next-generation proof edge.
- [ ] A ten-task homogeneous reconciliation fixture remains eligible while a disconnected
  value-inflating addition is rejected.
- [ ] Existing SELECT/preflight tests and legacy singleton selection remain green; load-bearing new
  modules have sibling coverage at or above the project threshold.
- [ ] Plugin, `.claude`, and experiment projections/package checks agree byte-for-contract.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Code and decision contracts are committed on master under halt discipline.
- [ ] All four historical replay families and negative controls pass deterministically.
- [ ] No task duplication, task-count cap, or concurrency-as-candidate-horizon behavior remains.
- [ ] Bounded preparation/reselection, plugin/runtime mirror parity, and full focused tests pass.
- [ ] A fresh independent audit finds no refutation; operational wiring remains assigned to
  DIR-119-C rather than self-certified here.

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

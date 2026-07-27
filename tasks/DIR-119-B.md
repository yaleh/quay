---
id: DIR-119-B
title: Execute arbitrary-width composite milestones through phase DAGs,
  read-only audit shards, deterministic reconcile, and atomic Land
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
    DIR-119-B
    experiments/quay-perpetual-stream/charters/M189-dir119b-composite-execution.md
    /tmp/m189-absorb-entry.md
---

**type:** execution

## Proposal

Extend the checked milestone contract and `execute-milestone` workflow from scalar `taskId` to an
arbitrary non-empty task array selected by DIR-119-A. Normalize legacy single-task calls, validate
membership/AC/phase/audit/hash/capacity contracts, execute work by phase rather than by task, audit
the final integrated candidate through read-only shards, reconcile task/absorb state only after all
verdicts pass, and Land all task outcomes atomically.

Task count must not map one-for-one to agents. Shared phases have one owner; independent phases may
fan out within the global resource budget; one audit shard may cover several homogeneous tasks while
returning per-task/per-AC verdicts. Land increments the milestone counter once and records completed
task count separately. Partial Land is out of scope.

## Plan

Depends on DIR-119-A. Execute Phase 2 / Stages 2.1–2.6 of
`docs/plans/adaptive-composite-milestone-select-and-execution.md`. This child edits the active
execution/audit/Land control plane and is human-steered under halt.

## Acceptance Criteria

- [ ] `execute-milestone` accepts both legacy `{taskId,...}` and selected
  `MilestoneCandidate.taskIds`; both normalize to one non-empty internal task array.
- [ ] No schema, prompt, loop, fixture, or configuration imposes a maximum composite task count.
- [ ] A mechanical composite contract checks membership, hashes, AC→phase→audit coverage, union
  touches, semantic resources, acyclic phase dependencies, temporal-proof exclusion, capacity, and
  atomic Land.
- [ ] Valid 1-, 3-, 5-, and 10-task fixtures pass; duplicate IDs, stale hashes, uncovered ACs,
  cycles, forbidden temporal edges, and over-capacity fixtures fail closed.
- [ ] Build consumes a phase DAG; shared phases have one owner and task count does not determine
  agent count.
- [ ] Audit shards inspect the final integrated candidate, return per-task/per-AC plus bundle
  verdicts, and make no task, absorb, dashboard, counter, or lifecycle writes.
- [ ] A deterministic reconciler validates receipts before updating task checkboxes/provenance and
  absorb dispositions in the candidate branch.
- [ ] Every task-scoped gate runs for every member; milestone-scoped gates run once; any failure
  prevents all Land mutations.
- [ ] Atomic Land marks every task consistently, captures all evidence, writes one dashboard entry,
  and increments `milestone_counter` exactly once regardless of task count.
- [ ] Negative controls prove no partial task lifecycle mutation reaches master after Audit,
  Reconcile, Gate, anti-drift, or Land failure.
- [ ] Legacy singleton golden replay remains behavior-compatible.
- [ ] Workflow/plugin/package mirrors and all focused/full suites pass with required coverage.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Source implementation and arbitrary-width contracts are committed on master under halt.
- [ ] Valid 1/3/5/10-task and invalid dependency/capacity/atomicity fixtures pass as specified.
- [ ] Read-only audit, deterministic reconcile, atomic Land, and singleton golden replay are green.
- [ ] No two-task-only, one-auditor-per-task, or best-effort partial-Land mechanism remains.
- [ ] A fresh independent audit finds no refutation; operational wiring remains assigned to
  DIR-119-C rather than self-certified here.

## Touches

- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `plugin/scripts/*composite*`
- `plugin/scripts/*reconcile*`
- `experiments/quay-perpetual-stream/scripts/*composite*`
- `experiments/quay-perpetual-stream/scripts/*reconcile*`
- `plugin/test/*composite*`
- `plugin/test/*reconcile*`
- `experiments/quay-perpetual-stream/test/*composite*`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `plugin/test/plugin-packaging.test.mjs`

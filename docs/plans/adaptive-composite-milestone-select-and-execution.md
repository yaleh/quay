# Plan: SELECT-integrated adaptive composite milestones

- **Status:** proposed implementation plan for DIR-119 and its ordered children
- **Date:** 2026-07-27
- **Proposal:** [`quay-adaptive-task-packing-and-overlap-concurrency.md`](../proposals/quay-adaptive-task-packing-and-overlap-concurrency.md)
- **Execution class:** control-plane / human-steered; halt, golden replay,
  immutable-generation identity, independent audit, and next-generation proof
  are mandatory
- **Landing policy:** each implementation milestone is atomic; DIR-119 remains
  open until a cold later-generation real composite is selected and landed

## 1. Outcome

Change Quay's selection and execution model from:

```text
rank tasks → take top concurrency tasks → author charters → execute one task per milestone
```

to:

```text
enrich task pool
→ build coupling graph
→ synthesize singleton and composite MilestoneCandidates
→ select a non-overlapping MilestonePortfolio
→ prepare and revalidate
→ execute arbitrary-width phase-DAG milestones
→ reconcile and Land atomically
```

No implementation component may contain a maximum composite task count.
Capacity is decided from graph cohesion, temporal dependencies, phase/audit
structure, critical path, line/context/resource budgets, and atomic failure
cost.

## 2. Compatibility and invariants

1. A one-task `MilestoneCandidate` reproduces the current single-task path.
2. Existing `{taskId, charterFile, absorbEntryFile}` workflow calls remain
   accepted and normalize to `taskIds: [taskId]`.
3. `candidate_horizon` is independent of execution `concurrency`.
4. Each task appears in at most one selected milestone candidate.
5. Composite formation occurs inside SELECT before final portfolio choice.
6. Preparation may invalidate a provisional group and return it to SELECT,
   with at most three reselect rounds.
7. `proof-after-land`, next-generation, learning-feedback, and
   result-dependent-selection edges cannot be internalized in one composite.
8. Build and Audit are scheduled by phases/shards, not one agent per task.
9. Audit remains verdict-producing; deterministic reconciliation owns task and
   absorb mutation.
10. Land is atomic and increments `milestone_counter` once regardless of task
    count.
11. Every task retains its own AC/DoD verdict, status, and provenance.
12. A workflow/control-plane change cannot prove its own installed wiring from
    the generation that authored it.

## 3. Data contracts

### 3.1 Task facts

Add a versioned `TaskCandidate` projection containing:

- task ID, status, labels, value type, eligibility;
- estimated value and delivery surface;
- declared and checked touch paths;
- semantic resources;
- dependency edges and verification boundary;
- AC count, line estimate, and evidence/audit classification;
- source hashes and fact provenance.

Task facts are cheap pre-charter inputs. Missing or ambiguous safety facts fail
closed for composite synthesis but do not remove the singleton candidate.

### 3.2 Coupling graph

Represent pairwise and explicit multi-task relationships:

```ts
type CouplingKind =
  | "same-deliverable"
  | "shared-implementation"
  | "shared-semantic-resource"
  | "internal-order"
  | "proof-after-land"
  | "next-generation"
  | "result-dependent"
  | "learning-feedback"
  | "conflicts"
```

Every edge records source evidence and whether it supports aggregation,
requires internal ordering, or prohibits a same-milestone boundary.

### 3.3 Milestone candidates

Add a versioned `MilestoneCandidate` projection:

- stable candidate ID;
- non-empty task-ID array;
- delivery hypothesis and union value;
- phase DAG and audit-shard plan;
- shared phases and semantic resources;
- estimated critical path, fixed-cost saving, coordination cost, and atomic
  failure cost;
- verification boundary and atomic Land policy;
- checked task/charter/Plan/source hashes.

Singleton and composite candidates share this schema.

### 3.4 Portfolio

`MilestonePortfolio` contains a set of selected candidates plus rejected
alternatives and reasons. It validates:

- task membership uniqueness;
- inter-candidate dependency order;
- cadence/value constraints;
- milestone and global resource budgets;
- ordinary disjointness or separately authorized overlap policy.

## Phase 1 — SELECT candidate synthesis (DIR-119-A)

### Stage 1.1 — RED fixtures and historical cases

Create deterministic fixtures before implementation:

1. DIR-114 + M176 capture gap + DIR-115 forms a three-task
   workflow-hardening candidate.
2. DIR-109–DIR-112 produces several comparable singleton/composite shapes.
3. DIR-062-B→DIR-062-C is split by its next-generation proof edge.
4. A ten-task homogeneous reconciliation group is not rejected because of
   cardinality.
5. An unrelated disconnected task cannot be added merely to inflate value.
6. A task cannot occur in two selected milestone candidates.

Expected RED: current SELECT exposes only individual shortlist tasks and cannot
represent these outcomes.

### Stage 1.2 — Task facts and coupling graph

Implement pure, fixture-driven modules for:

- extracting/checking task facts;
- representing semantic resources and temporal dependencies;
- building the coupling graph;
- reporting missing/ambiguous evidence conservatively.

Reuse current `## Touches` parsing and orthogonality logic rather than forking
it.

### Stage 1.3 — Candidate synthesis

Implement bounded seed/beam expansion:

1. retain every eligible singleton;
2. seed from ranked tasks;
3. expand through positive coupling and required dependency closure;
4. prune cycles, temporal-proof edges, disconnected additions, and negative
   marginal contribution;
5. retain a configurable number of distinct shapes per seed.

Do not enumerate the power set and do not cap `taskIds.length`.

### Stage 1.4 — Portfolio choice

Score candidates using union delivery value, fixed-context savings, critical
path, cadence, coordination, resource use, and atomic failure cost. Choose a
non-overlapping set under milestone concurrency and global budgets.

The initial implementation may use deterministic weighted set-packing/beam
search. It must emit a durable decision record containing selected and rejected
candidate shapes.

### Stage 1.5 — Preparation feedback

Move final SELECT commitment after checked preparation. If preparation changes
touches, semantic resources, dependencies, capacity, or compatibility:

```text
invalidate provisional candidate
→ update facts
→ regenerate candidate shapes
→ reselect portfolio
```

Stop after three rounds and split/route to human review.

### Stage 1.6 — Wiring and GREEN

Wire the new model through:

- `select-preflight.ts` and its workflow wrapper;
- OUTER-LOOP SELECT;
- task/charter preparation dispatch;
- final batch assembly and write-back;
- plugin/runtime mirrors and packaging checks.

GREEN requires every Stage 1.1 replay plus existing SELECT fixtures and
single-task behavior.

## Phase 2 — arbitrary-width composite execution (DIR-119-B)

### Stage 2.1 — Workflow argument normalization

Extend `execute-milestone` to accept:

```text
legacy: {taskId, charterFile, absorbEntryFile}
new:    {milestoneCandidate, charterFile, compositeManifestFile, absorbEntryFile}
```

Normalize both forms to a non-empty task array. Reject duplicate/invalid task
IDs, stale hashes, or conflicting legacy/new arguments. Do not reject based on
array length.

### Stage 2.2 — Composite contract and phase DAG

Add a mechanical contract checker proving:

- task membership matches candidate, charter, and Plan;
- every task AC maps to at least one phase and audit shard;
- every shared phase maps to an integration invariant;
- phase dependencies are acyclic;
- union touches and semantic resources are complete;
- no forbidden temporal edge is internalized;
- phase/context/line/audit/resource capacity is valid;
- Land is atomic.

Exercise valid task arrays of length 1, 3, 5, and 10, plus fail-closed capacity
and temporal-dependency fixtures.

### Stage 2.3 — Build phase execution

Build consumes the checked phase DAG:

- shared or overlapping phases have one owner;
- independent phases may be dispatched in parallel within the global resource
  budget;
- integration barriers join phase results into one candidate;
- task count never maps directly to agent count;
- the iteration report maps files, commits, tests, and evidence back to tasks
  and phases.

The first implementation may serialize all phases through one Build lead when
parallel phase execution is unavailable; the contract must still be arbitrary
width and phase-based.

### Stage 2.4 — Read-only audit shards

Audit the final integrated candidate using checked shards:

- task/AC shards;
- semantic-integration shards;
- wiring/system shards where required.

One shard may cover several homogeneous tasks. Outputs include immutable
per-task/per-AC verdicts and a bundle verdict. No auditor checks task boxes,
writes absorb dispositions, updates dashboards, or changes lifecycle state.

### Stage 2.5 — Deterministic reconcile and gates

Only after every required verdict passes:

- validate audit hashes and generation identity;
- update task checkboxes/provenance in the candidate branch;
- write per-task and bundle absorb dispositions;
- run task-scoped DoD and split-or-commit gates for every task;
- run milestone-scoped gates once;
- fail atomically on any error.

### Stage 2.6 — Atomic Land and compatibility

Land one integrated candidate and:

- mark all tasks consistently;
- capture charter, manifest, iteration, audits, and decision record;
- append one composite dashboard entry;
- increment milestone counter once;
- record task-completion count separately.

Golden replay the legacy singleton workflow byte-for-behavior where applicable.
No partial Land is introduced.

## Phase 3 — next-generation real proof (DIR-119-C)

### Stage 3.1 — Cold materialization

Materialize a fresh workflow/runtime generation from the landed Phase 1/2
source. Record script path, content hash, source commit, runtime generation,
dispatch form, session identity, and materialization time.

### Stage 3.2 — Real SELECT proof

Run normal SELECT against the real task pool. A qualifying canary must:

- be synthesized by SELECT before final portfolio choice;
- contain at least three real tasks, proving removal of the old implicit
  two-task shape;
- pass coupling, capacity, preparation, and portfolio constraints;
- not have membership hand-injected after SELECT.

If no qualifying real group exists, retain `awaiting-real-composite-proof`; do
not force an incoherent bundle.

### Stage 3.3 — End-to-end execution

Execute the selected composite through Verify, Build, read-only audit shards,
Reconcile, Gate, and atomic Land. Verify:

- all task AC/DoD and provenance records;
- one milestone counter increment;
- one dashboard entry with task count and candidate identity;
- source/runtime hash agreement;
- full and focused tests;
- no partial mutation on negative controls.

### Stage 3.4 — Independent wiring audit and parent closure

A fresh auditor reads primary artifacts only and confirms:

- SELECT actually synthesized the group;
- rejected candidate alternatives were recorded;
- the installed arbitrary-width workflow ran;
- audit was read-only and reconcile owned mutation;
- atomic Land and task/milestone accounting are correct.

Only then may DIR-119-C and parent DIR-119 become done.

## 4. Expected source surfaces

The exact file list is refined by checked preparation, but the expected surface
includes:

- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `.claude/workflows/select-preflight.js`
- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/select-preflight.js`
- `plugin/workflows/execute-milestone.js`
- `experiments/quay-perpetual-stream/scripts/select-preflight.ts`
- `plugin/scripts/*candidate*`
- `plugin/scripts/*coupling*`
- `plugin/scripts/*portfolio*`
- `plugin/scripts/*composite*`
- corresponding experiment projections, fixtures, and tests
- plugin packaging/distribution conformance tests
- milestone decision, preparation, audit, and wiring receipts

Any checked Plan expansion updates `## Touches` and returns to final portfolio
selection before dispatch.

## 5. Verification commands

The implementation Plan must replace globs with exact discovered paths where
appropriate. At minimum:

```bash
node --test experiments/quay-perpetual-stream/test/select-preflight.test.mjs
node --test experiments/quay-perpetual-stream/test/*candidate*.test.mjs
node --test experiments/quay-perpetual-stream/test/*composite*.test.mjs
node --test plugin/test/*composite*.test.mjs
node --test plugin/test/plugin-packaging.test.mjs
bash experiments/quay-perpetual-stream/scripts/task-schema-selfcheck.sh
scripts/test.sh
```

Each load-bearing pure module requires sibling coverage at or above the project
threshold. A source-only GREEN is insufficient; Phase 3 real wiring evidence is
mandatory.

## 6. Rollback

- Phase 1 preserves the legacy SELECT projection behind compatibility
  normalization until historical replay passes.
- Phase 2 preserves the legacy singleton workflow.
- No candidate worker merges to master; serial Land/fan-in remains sole owner.
- A failed composite leaves task lifecycle state unchanged on master.
- Runtime activation is generation-boundary-only; rollback selects the prior
  immutable generation.
- Any unexpected semantic overlap, stale preparation, or audit mismatch aborts
  before Land.


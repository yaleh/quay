# Milestone workflow stage pipelining and lease-scoped concurrency for Quay

- **2026-07-28 correction:** this proposal's original context assumed that the
  then-current `execute-milestone.js` Build phase already used a per-milestone
  worktree. That premise was false for the live implementation: commit `4191a31`
  removed `isolation: 'worktree'`, and M187–M191 built directly in the shared
  primary checkout. Treat every statement below that says “current workflow already
  uses worktrees” as a target/precondition, not a description of current behavior.
  `DIR-123` now owns restoring real per-milestone worktree isolation. See
  [`milestone-workflow-performance-and-capability-regression-analysis.md`](../milestone-workflow-performance-and-capability-regression-analysis.md)
  for the implementation/history/session evidence and updated sequencing.
- **Status:** proposal / architecture discussion only. This document does not
  change the active loop, enable new concurrency, create an implementation
  directive, or authorize a runtime-generation upgrade.
- **Date:** 2026-07-27
- **Context:** recent exp5 execution demonstrated useful whole-milestone
  concurrency (M186 and M187), but also exposed the limits of the current
  batch-and-barrier model: conservative milestone-wide touch exclusion, shared
  Git index hazards, a long Build-to-Audit tail, and full-suite resource
  contention. This proposal preserves the one-workflow-per-milestone unit,
  restores the missing one-worktree-per-milestone isolation boundary, and
  increases throughput by pipelining workflow stages across milestones,
  applying leases only to conflicting effects and resources.
- **Related:**
  [`quay-adaptive-task-packing-and-overlap-concurrency.md`](./quay-adaptive-task-packing-and-overlap-concurrency.md)
  changes SELECT and milestone boundaries. ·
  [`adaptive-composite-milestone-select-and-execution.md`](../plans/adaptive-composite-milestone-select-and-execution.md)
  and `DIR-119-B` define phase-DAG execution, read-only audit, deterministic
  reconciliation, and atomic Land inside a singleton or composite milestone. ·
  [`exp5-concurrent-background-agents-for-milestone-iteration.md`](./exp5-concurrent-background-agents-for-milestone-iteration.md)
  records the earlier no-nesting and shared-state analysis. ·
  [`ADR-017`](../../adr/ADR-017-concurrent-multi-milestone-execution-touches-disjoint.md)
  establishes the current touches-disjoint batch rule and serial fan-in. ·
  [`quay-immutable-runtime-generations-and-atomic-activation.md`](./quay-immutable-runtime-generations-and-atomic-activation.md)
  defines the generation fence required for workflow self-development. ·
  [`quay-milestone-workflow-throughput-capacity-model.md`](./quay-milestone-workflow-throughput-capacity-model.md)
  separates candidate, leaf-task, and attempt rates and records rollout and
  mature-state capacity hypotheses for this pipeline.

## 1. Decision summary

Quay should retain the existing workflow-level milestone unit while restoring
the worktree boundary the live implementation lost:

```text
one selected milestone
→ one execute-milestone workflow
→ one isolated worktree and candidate branch
```

but replace batch-wide execution barriers with a stage pipeline:

```text
Prepare → Verify → Build → Integrate → Audit → Local Gate
                                                ↓
                                         Ready-to-Land
                                                ↓
                                  Revalidate → Reconcile → Land
```

Many milestone workflows may occupy different stages concurrently. Worktree
workers produce immutable candidate commits and receipts; they do not merge
master or mutate shared lifecycle/methodology state. A single fenced Land owner
per workspace performs the short, serial transaction that revalidates the
candidate against current master, reconciles receipts, merges, and updates
tasks, ABSORB state, dashboard, backlog, and milestone counter.

Concurrency admission is no longer decided solely from a milestone-wide union
of paths. It is decided from:

- stage-specific read and write sets;
- semantic resources that may conflict without sharing a file;
- immutable base, candidate, task, charter, Plan, and runtime-generation
  hashes;
- agent, CPU, memory, test, browser-port, and integration-writer budgets;
- dependency and learning/visibility barriers; and
- real post-Build diffs checked before Land.

Locks are not the primary execution model. Isolated worktrees plus optimistic
validation remain the default. Leases and semaphores protect only effects whose
concurrent execution is unsafe or predictably destructive.

## 2. Problem statement

### 2.1 Current concurrency is coarse and barrier-bound

The current scheduler admits a batch only when whole milestone declarations are
execution-type, capability-growth, shared-state-free, and pairwise
touches-disjoint. Every workflow then executes its complete
Verify→Build→Audit→Gate→Land sequence, and fan-in waits for the entire batch.

This is safe in principle but leaves throughput on the table:

- a milestone that will eventually update `dashboard.md` is serialized even
  when its Build changes only an independent package;
- a fast candidate waits for the slowest member of its batch before fan-in;
- one long Build prevents its workflow from reaching Audit while other agent
  capacity may be idle;
- milestone-wide file overlap cannot distinguish a harmless integration point
  from a shared semantic invariant; and
- a fixed `concurrency` number ignores the very different cost of source edits,
  focused tests, full-suite tests, audits, and Land.

### 2.2 Worktrees must be restored, but will not isolate all effects

The live milestone workflow does not currently use worktrees; `DIR-123` owns
restoring that necessary foundation. Once restored, worktrees will isolate
checkout state and ordinary edits, but will not by themselves isolate:

- the repository's shared index when a worker accidentally operates on the
  primary worktree;
- two branches changing the same semantic resource through different files;
- task status, checkbox, provenance, ABSORB, dashboard, backlog, V-meta, gate
  event, and counter mutations;
- ports, CPU, memory, package caches, and full-suite capacity;
- a gate receipt whose base revision has become stale; or
- SELECT decisions whose learning epoch has changed.

Therefore "one worktree per milestone" is necessary but insufficient. The
missing abstraction is an explicit stage effect and receipt contract.

### 2.3 Audit currently carries writes that prevent free parallelism

The current Audit stage both decides a verdict and writes task checkboxes,
ABSORB dispositions, deviation rows, and audit artifacts. These writes turn an
otherwise read-heavy, naturally parallel phase into a candidate/global-state
writer. They also make audit independence harder to reason about: the verdict
producer owns part of its own disposition mutation.

Audit should instead return immutable, hash-bound verdict receipts. A separate
deterministic reconciler should validate those receipts and own every resulting
checkbox, provenance, and disposition update.

### 2.4 Recent evidence shows both the opportunity and the capacity risk

M186 and M187 ran concurrently. M187 completed in roughly 32 minutes while the
larger M186 continued for roughly 81 minutes, recovering most of M187's wall
time compared with serial execution. M185 was also largely orthogonal and could
have overlapped more of that interval under a rolling stage scheduler.

M188 showed the opposite failure mode: multiple concurrent workers and a full
repository suite caused existing typecheck integration tests to hit 60-second
timeouts. The same tests passed in isolation. Worktree isolation would prevent
source collision but would not prevent this resource contention. Increasing
an undifferentiated concurrency integer can therefore reduce throughput even
after `DIR-123` lands.

## 3. Scope and relationship to DIR-119

This proposal and DIR-119 address different scheduling axes:

| Concern | Primary owner |
|---|---|
| Which tasks form one milestone | DIR-119-A / SELECT candidate synthesis |
| How one singleton/composite milestone executes its internal phase DAG | DIR-119-B |
| Whether the installed mechanism works in a later real generation | DIR-119-C |
| How several existing milestone workflows overlap stages across milestones | This proposal |

The designs should share contracts rather than create parallel abstractions.
DIR-119-B's phase receipts, read-only audit shards, reconciler, and atomic Land
are directly reusable here. A singleton milestone is the first rollout target;
composites use the same stage pipeline after DIR-119-B exists.

This proposal does not require immediate within-Build fan-out. A first release
may keep each workflow's Build agent inline and still gain substantial wall-time
reduction by overlapping one milestone's Build with another's Verify or Audit.

## 4. Execution and state contracts

### 4.1 Run identity

Every workflow attempt receives an immutable identity envelope:

```ts
interface MilestoneRunIdentity {
  executionId: string;
  attempt: number;
  workspaceId: string;
  candidateId: string;
  taskIds: string[];
  baseCommit: string;
  taskHashes: Record<string, string>;
  charterHash: string;
  planHash?: string;
  runtimeGeneration: string;
  workflowHash: string;
}
```

Every stage receipt carries this identity. A receipt from another candidate
commit, task generation, workflow generation, or attempt is invalid.

### 4.2 Stage effects

Preparation emits checked stage effects:

```ts
interface StageEffects {
  reads: string[];
  declaredWrites: string[];
  semanticResources: string[];
  runtimeResources: ResourceClaim[];
  dependsOn: string[];
  globalStateMutation: boolean;
  staleWhen: InvalidationRule[];
}
```

The scheduler treats declared writes as a lease/admission hint, not proof.
Actual writes are computed from the candidate diff and checked before
Ready-to-Land.

Semantic resources cover conflicts file paths cannot express, including:

- `task-schema`;
- `provider-abi`;
- `workflow-generation`;
- `gate-contract`;
- `milestone-accounting`;
- `release-layout`; and
- any task-specific protocol or data-model invariant.

### 4.3 Stage receipts

Each completed stage returns an immutable receipt:

```ts
interface StageReceipt {
  schemaVersion: 1;
  identity: MilestoneRunIdentity;
  stage: string;
  inputHashes: Record<string, string>;
  outputCommit?: string;
  actualReads?: string[];
  actualWrites?: string[];
  tests?: TestReceipt[];
  verdict?: string;
  evidence: EvidenceRef[];
  startedAt: string;
  completedAt: string;
}
```

Receipts are content-addressed and append-only. A retry creates a new attempt;
it does not overwrite evidence from the previous attempt.

### 4.4 Ready-to-Land

The concurrent workflow must stop before any master merge and return:

```ts
interface ReadyToLandReceipt {
  identity: MilestoneRunIdentity;
  candidateCommit: string;
  buildReceipts: string[];
  auditReceipts: string[];
  localGateReceipts: string[];
  declaredWrites: string[];
  actualWrites: string[];
  semanticResources: string[];
  proposedReconcilePatchHash: string;
}
```

This replaces the current concurrent path's ambiguous responsibility split.
Candidate workers produce committed branches. The serial Land owner is the only
process permitted to merge or update shared state.

## 5. Stage pipeline

### 5.1 States

```text
QUEUED
  → PREPARING
  → VERIFYING
  → BUILDING
  → INTEGRATING
  → AUDITING
  → LOCAL_GATING
  → READY_TO_LAND
  → REVALIDATING
  → RECONCILING
  → LANDING
  → LANDED
```

`FAILED`, `REFUTED`, `STALE`, `RETRYABLE`, and `NEEDS_HUMAN` are explicit
terminal or recovery states. Recovery resumes from the earliest invalid stage,
not automatically from Verify.

### 5.2 Cross-milestone overlap

A representative schedule is:

```text
time →
M1  BUILD================ INTEGRATE → AUDIT → GATE → [LAND]
M2  VERIFY → BUILD======================= → AUDIT ------→ [LAND]
M3  PREP → VERIFY → BUILD=============================→ [LAND]
M4  PREP → VERIFY → wait(build slot) → BUILD==========→ [LAND]
```

Only the bracketed Land transactions are strictly serialized. Waiting for Land
does not hold Build, Audit, or heavy-test resources.

### 5.3 Local versus global gates

Candidate-local gates run in the worktree and may execute concurrently:

- task/AC/DoD evidence checks;
- focused and package tests;
- source/package mirror checks;
- candidate-tree hygiene;
- candidate contract and phase-DAG validation; and
- audit receipt completeness.

Stale-sensitive/global gates run or re-run under the Land fence:

- actual-diff versus declared-write/lease validation;
- semantic-resource conflict against commits landed since `baseCommit`;
- task lifecycle and split-or-commit checks against current master;
- dashboard/V-meta/counter consistency and line budgets;
- worktree/branch hygiene;
- generation identity; and
- integration tests selected by the invalidation map.

The Land fence must not contain avoidable long-running full suites. Heavy tests
run before the fence; under the fence, only tests invalidated by intervening
commits are repeated.

### 5.4 Rolling Land, not batch-wide fan-in

A candidate reaching `READY_TO_LAND` joins a workspace Land queue immediately;
it does not wait for slower workflows dispatched in the same SELECT wave.

The Land owner:

1. acquires the workspace integration-writer lease and fencing token;
2. compares current master with the candidate's `baseCommit`;
3. evaluates intervening actual writes and semantic-resource receipts;
4. marks the candidate `STALE` if preparation/audit is invalid;
5. otherwise rebases or applies the candidate in a temporary integration
   worktree;
6. re-runs stale-sensitive gates;
7. deterministically reconciles audit receipts and lifecycle mutations;
8. atomically commits code, task/evidence state, ABSORB, views, and counter; and
9. emits a Land receipt before releasing the lease.

Land queue ordering should be deterministic but need not equal dispatch order.
Use a stable priority such as readiness time followed by candidate ID, with an
aging term to prevent starvation.

## 6. Lease and resource model

### 6.1 Four distinct mechanisms

The implementation must not collapse all concurrency control into one lock:

| Mechanism | Purpose |
|---|---|
| Worktree isolation | Independent checkout, edits, commits, and candidate tests |
| Effect lease | Prevent unsafe concurrent mutation of files/globs or semantic resources |
| Resource semaphore | Bound CPU, memory, ports, full suites, package builds, and agent slots |
| Integration fence | Guarantee one authoritative Reconcile/Land writer per workspace |

Read/read activity requires no effect lease. Write/write overlap may use either
exclusive admission or optimistic parallelism followed by validation, depending
on the resource's conflict cost.

### 6.2 Lock ordering and deadlock avoidance

When a stage needs several exclusive leases, it requests the complete canonical
set atomically in this order:

```text
runtime generation
→ semantic resources
→ path/glob effects
→ runtime resources
→ integration writer
```

No worker may hold a subset while waiting for the remainder. Failed acquisition
returns the stage to the scheduler with an observable wait reason.

### 6.3 Lease durability

Every lease records:

```text
key, ownerExecutionId, attempt, stage, fencingToken,
baseCommit, acquiredAt, leaseUntil, heartbeatAt
```

Required behavior:

- TTL and heartbeat recovery after worker death;
- compare-and-swap renewal;
- monotonically increasing fencing tokens;
- expired workers cannot commit or mutate lifecycle state;
- idempotent release and terminal event recording; and
- inspection of owners, waiters, age, and renewal failures.

A workspace-scoped SQLite store is preferred for recovery and diagnostics. An
atomic-directory or `flock` prototype is acceptable only for an initial
single-machine experiment and must not be mistaken for the durable contract.

### 6.4 Initial resource budgets

Resource classes should be configured independently:

```yaml
pipeline:
  prepare_slots: 4
  verify_slots: 4
  build_slots: 2
  audit_slots: 3
  heavy_test_slots: 1
  browser_test_slots: 1
  reconcile_slots: 1
  land_slots: 1
  cpu_budget: 8
  memory_budget_mb: 24000
```

These are workspace policy values, not delivery defaults. The shipped product
supports the schema and admission logic; each adopting project chooses values
from measured capacity.

## 7. Audit and reconciliation

Audit shards inspect a fixed final candidate commit and are read-only with
respect to:

- task markdown and lifecycle status;
- checkbox/provenance state;
- ABSORB entries;
- dashboard, backlog, V-meta, and counter;
- master and the candidate branch.

They may write only their own immutable receipt/artifact in an isolated output
location. A shard can cover several homogeneous tasks but must return
per-task/per-AC verdicts plus any bundle-level verdict.

The reconciler:

1. verifies auditor independence and receipt hashes;
2. confirms every required task, AC, DoD, and integration invariant has one
   authoritative verdict;
3. rejects missing, duplicate, contradictory, stale, or wrong-generation
   receipts;
4. creates the task checkbox/provenance and ABSORB patch deterministically; and
5. performs no master mutation until all task and bundle gates pass.

This model applies equally to singleton and composite milestones and directly
aligns with DIR-119-B.

## 8. Learning and generation barriers

Learning work need not hold a global lock for its entire Build/Audit duration,
but its visible ABSORB is an epoch transition:

```text
learning Build/Audit may run in isolation
→ acquire learning-epoch + integration fence
→ Land and update V_meta
→ invalidate SELECT/preparation receipts derived from the prior epoch
→ permit the next authoritative SELECT
```

The first rollout keeps learning milestones serial. A later experiment may
allow speculative Build/Audit only when:

- results remain invisible before the epoch transition;
- candidates record the input learning epoch;
- stale candidates are mechanically re-prepared or discarded; and
- speculation cannot consume Land capacity ahead of authoritative work.

Workflow/control-plane milestones additionally bind to immutable runtime
generation identity and cannot certify their own installed behavior.

## 9. Safety invariants

1. Candidate workers never merge master.
2. Exactly one fenced Land owner mutates shared workspace state.
3. Audit is verdict-producing and read-only; reconciliation owns write-back.
4. Every stage receipt binds to base, candidate, task, charter/Plan, and runtime
   hashes.
5. Actual writes are checked against declarations and co-running/landed
   effects before master mutation.
6. File disjointness does not override semantic-resource conflicts.
7. A failed or stale candidate causes no partial master lifecycle mutation.
8. No worker retains authority after lease expiry or fencing-token replacement.
9. Heavy test concurrency is bounded separately from agent concurrency.
10. Learning and runtime-generation transitions invalidate older dependent
    receipts.
11. Singleton behavior remains compatible; pipeline concurrency is opt-in.
12. Halt prevents new stage admission and new Land transactions; in-flight
    workers reach a bounded checkpoint and retain recoverable receipts.

## 10. Failure and recovery behavior

| Failure | Recovery |
|---|---|
| Verify/local gate failure | stop candidate; retain receipts; no Land |
| Build worker loss | expire lease; retry from last valid stage/checkpoint |
| Audit shard loss | retry only missing shard against same candidate hash |
| Audit refutation | candidate remains isolated; route according to lifecycle policy |
| Actual-write drift | mark stale/refuted; re-prepare or serialize |
| Master advanced on unrelated effects | rebase/apply and re-run invalidated global gates |
| Master advanced on conflicting effect | return to Integrate/Build or serialize after owner |
| Land owner loss before commit | fencing token expires; retry transaction idempotently |
| Land owner loss after commit | recover from Land receipt/commit identity; never double-increment |
| Resource timeout under contention | release resource claim; retry with measured backoff |

## 11. Observability and throughput measurement

Every run should emit stage events containing queue, execution, and lock time:

```text
executionId, candidateId, stage, attempt,
queuedAt, startedAt, completedAt,
waitReason, leaseKeys, resourceClaims,
baseCommit, candidateCommit, outcome
```

Minimum dashboard metrics:

- end-to-end milestone wall time;
- critical-path duration;
- stage utilization and queue time;
- Land-fence hold time;
- lease contention by key;
- stale/revalidation/retry rate;
- test-resource saturation and timeout rate;
- speculative work discarded;
- serial baseline versus pipelined throughput; and
- quality regressions or audit refutation rate.

The optimization succeeds only if wall time and throughput improve without
raising refutation, stale-work, partial-mutation, or flaky-test rates.

Specific values such as two active worktrees, one full-suite slot, or 1.5–2.0
effective concurrent agents are conservative single-machine rollout settings,
not architectural invariants. Pure Reconcile work may run concurrently; only
the authoritative Land transition must remain linearizable. The detailed
baseline, bottleneck model, configurable limits, and rollout/mature throughput
targets are maintained in
[`quay-milestone-workflow-throughput-capacity-model.md`](./quay-milestone-workflow-throughput-capacity-model.md).

## 12. Rollout plan

### O0 — Measure current stages

Add stage timestamps and resource observations without changing scheduling.
Establish a serial baseline over several real milestones.

### O1 — Correct merge ownership

Make concurrent workflows stop at `READY_TO_LAND`. Remove all candidate-worker
master merge and shared-state mutation. Keep existing batch admission and
serial fan-in while proving the new receipt boundary.

### O2 — Read-only audit and deterministic reconcile

Adopt DIR-119-B-compatible audit receipts and reconciler for singleton
milestones. Golden replay current singleton outcomes and negative controls.

### O3 — Resource-aware cross-stage pipeline

Allow Prepare/Verify/Build/Audit of different touches-disjoint execution
milestones to overlap. Keep current batch-wave selection and a single Land
queue. Add the heavy-test and browser-test semaphores.

### O4 — Rolling Ready-to-Land queue

Remove the batch-wide completion barrier. Land each ready, valid candidate
without waiting for its original peers. Measure stale/rebase cost.

### O5 — Stage effect and semantic leases

Admit selected milestone-wide path overlaps when the conflicting effects occur
in different stages or are owned by the serial reconciler. Preserve
fail-closed semantic-resource policy and actual-diff verification.

### O6 — Composite and speculative extensions

Run DIR-119 composite milestones through the same scheduler. Only after the
execution path is stable, evaluate speculative learning Build/Audit with epoch
invalidation.

Each rollout level requires an immutable next-generation activation, focused
and full tests, negative controls for worker loss/stale receipts/partial Land,
and a fresh independent wiring audit. A level may be rolled back without
invalidating receipts from earlier levels.

## 13. Acceptance evidence for a future implementation

A future Plan should require at least:

1. a three-milestone trace where M1 is in Audit, M2 in Build, and M3 in Verify
   concurrently;
2. a fast milestone reaching Land without waiting for a slow peer from the same
   SELECT wave;
3. proof that no candidate worker can merge master;
4. forced worker death and lease-expiry recovery;
5. stale-base and semantic-conflict negative controls;
6. audit receipts that cannot mutate task/dashboard/ABSORB state;
7. a Land crash before and after commit with no duplicate task transition or
   counter increment;
8. full-suite semaphore evidence showing no contention-induced timeout;
9. singleton golden replay;
10. a measured wall-time improvement over the serial baseline; and
11. a cold next-generation real run and independent wiring audit.

## 14. Non-goals

- Removing worktrees or replacing Git as the candidate isolation mechanism.
- Allowing multiple master/integration writers.
- Treating file locks as sufficient semantic-conflict detection.
- Running every test or every agent at maximum concurrency.
- Weakening Audit, Gate, atomic Land, halt, generation, or provenance rules.
- Allowing best-effort partial Land of a composite milestone.
- Creating a permanent centralized phase engine unrelated to the existing
  workflow/skill model.
- Automatically enabling learning speculation.

## 15. Open decisions

1. Whether the durable lease/event store belongs in Quay core, the loop-driver
   plugin, or an exp5-only proving layer before productization.
2. Whether candidate artifacts live only on Git branches, in a workspace run
   directory, or both.
3. Which semantic resources are explicit task/Plan data versus derived during
   preparation.
4. Whether rolling Land uses strict readiness order, value-weighted aging, or a
   deterministic conflict-minimizing policy.
5. Which gate invalidation rules are trusted mechanically enough to avoid a
   full re-run under the Land fence.
6. Whether milestone numbers are allocated at selection, dispatch, or Land once
   completion order is no longer dispatch order.
7. What measured stale-work and refutation thresholds disable O4/O5
   automatically and return the workspace to batch or serial mode.

# Adaptive task packing and planned-overlap concurrency for Quay

- **Status:** proposal / architecture discussion only. This document does not
  enable concurrency, change the active loop, authorize an autonomous runtime
  upgrade, or create implementation directives. Adoption must proceed through
  the normal task, preparation, milestone, audit, and next-generation wiring
  lifecycle.
- **Date:** 2026-07-27
- **Context:** a review of the preceding 12 hours of Claude Code execution found
  that Quay already has much of the machinery required for disjoint milestone
  concurrency, but real throughput remains bounded by single-task milestone
  overhead, conservative rejection of every file overlap, serial fan-in, and
  recurring proof/rewiring failures. The review also identified two additional
  opportunities: pack strongly related tasks into one milestone, and admit
  selected overlapping tasks to concurrent execution when the expected
  integration cost is lower than the recovered wall-clock time.
- **Related:**
  [`exp5-concurrent-background-agents-for-milestone-iteration.md`](./exp5-concurrent-background-agents-for-milestone-iteration.md)
  records the earlier concurrency analysis and the original shared-state and
  SELECT←ABSORB concerns. ·
  [`quay-immutable-runtime-generations-and-atomic-activation.md`](./quay-immutable-runtime-generations-and-atomic-activation.md)
  defines the generation boundary required for safe self-development. ·
  [`DIR-107`](../../tasks/DIR-107.md) moves merge ownership to serial fan-in and
  adds audit-independence/anti-drift safeguards. ·
  [`DIR-113`](../../tasks/DIR-113.md) moves task-level touch-set screening before
  expensive charter authoring. ·
  [`DIR-117`](../../tasks/DIR-117.md) proposes a checked Proposal and milestone
  Plan before Build. ·
  [`DIR-118`](../../tasks/DIR-118.md) proposes non-bypassable post-Land,
  next-generation wiring proof.

## 1. Decision summary

Quay should evolve from a binary scheduler—

> disjoint tasks may run concurrently; all overlapping tasks are deferred

—into an adaptive scheduler with four execution shapes:

| Relationship | Execution shape |
|---|---|
| Independent tasks | Separate milestones, concurrent |
| Strongly cohesive tasks with shared delivery semantics | One composite milestone |
| Weakly overlapping tasks with bounded integration cost | Separate milestones, planned-overlap concurrency |
| Same semantic core, control plane, runtime generation, or shared mutable state | Serial or canary-first |

The scheduler should first construct a **task coupling graph**, synthesize both
singleton and composite milestone candidates, and then jointly choose milestone
boundaries and concurrency. It must not treat task documents as preordained
execution units.

Composite formation is part of SELECT—not a pre-SELECT grouping pass and not a
post-SELECT repair. SELECT therefore changes from `Task[] → Task[]` into:

```text
select(TaskPool, state, budgets) → MilestonePortfolio
```

A `MilestoneCandidate` contains one or more tasks. A singleton is the
one-task degenerate form; a composite is not a separate exception path.

The rollout places no cardinality limit on a composite. Admission is bounded by
cohesion, phase-DAG validity, milestone capacity, verification boundaries,
expected marginal value, atomic failure cost, and resource budgets. Initial
planned-overlap concurrency remains O1-only, with one active integration owner,
one serial fan-in owner, and one canary milestone per new runtime generation
before wider dispatch.

Concurrency remains an optimization, never a relaxation of acceptance,
independent audit, generation identity, or landing proof.

## 2. Problem statement

### 2.1 A task is not always the right execution transaction

The current `execute-milestone` contract takes one `taskId`. Verify, Build,
Audit, Gate, provenance write-back, dashboard update, and Land all assume a
one-task milestone.

That boundary is appropriate for independent work, but inefficient when a
group of tasks:

- change the same implementation skeleton;
- require the same repository exploration and test setup;
- expose multiple aspects of one user-visible capability;
- cannot be meaningfully integrated or audited in isolation; or
- would create a temporary compatibility layer if landed separately.

In those cases, task-level separation duplicates fixed workflow cost and moves
the real design decision into an unplanned Git merge.

### 2.2 File-disjointness is safe but too coarse

The current concurrent batch scheduler correctly fails closed when candidate
touch sets overlap. However, a shared path does not necessarily imply a shared
semantic mutation.

Two CLI tasks may both edit `packages/quay/bin/quay.ts` while adding separate
subcommands. Their text patches may overlap at an import block or command
registry, but the implementations and acceptance contracts remain independent.
Serializing the full workflows to avoid a small, predictable integration step
can cost tens of minutes.

Conversely, two tasks may edit different files while changing the same
protocol, schema, runtime-generation contract, or control-plane invariant.
File-disjointness alone is therefore both over-conservative and
under-expressive.

### 2.3 Fixed workflow cost is material

A representative recent closure workflow took approximately:

| Phase | Duration |
|---|---:|
| Verify | 1.3 min |
| Build | 6.1 min |
| Audit | 13.3 min |
| Gate | 0.6 min |
| Land | 7.2 min |
| **Total** | **28.5 min** |

Verify and Gate already contain internal fan-out. The largest remaining
opportunities are therefore:

1. amortize fixed Verify, audit setup, Gate, and Land work across cohesive
   tasks; and
2. overlap the Build→Audit→Gate critical paths of tasks whose integration cost
   is bounded.

### 2.4 Recent failures argue for bounded speculation

Recent M176–M180 work repeatedly encountered related ABSORB, audit, and wiring
gaps. Parallel execution could have exposed the common failure sooner, but it
could also have produced several branches requiring the same repair.

Session-history review also showed why a fixed two-task bundle is the wrong
abstraction. DIR-114, the M176 charter/audit-capture gap, and DIR-115 formed a
three-task `execute-milestone.js` hardening cluster with shared context and one
natural generation boundary. ADR-019 produced the four related DIR-109–DIR-112
test-management tasks. A separate lifecycle reconciliation operation advanced
ten stale tasks through the same evidence/status procedure. Conversely,
DIR-062-B→DIR-062-C had a next-generation proof dependency and must remain
separate despite thematic cohesion. Cardinality is therefore neither a safe
upper bound nor a sufficient admission rule.

The throughput design must distinguish:

- **product speculation**, where multiple ordinary capability changes may run
  against one proven runtime generation; from
- **control-plane speculation**, where multiple tasks modify the mechanism
  proving, scheduling, or activating their own work.

The latter remains canary-first.

## 3. Goals and non-goals

### 3.1 Goals

1. Increase completed-task throughput and reduce task lead time without
   weakening audit or wiring guarantees.
2. Allow milestone boundaries to follow implementation and acceptance cohesion,
   not merely task-document boundaries.
3. Admit low-risk file overlap when ownership and integration work are declared
   before dispatch.
4. Preserve per-task identity, acceptance criteria, evidence, status,
   provenance, and rollback within a multi-task milestone.
5. Price concurrency using observed execution, integration, contention, and
   rework costs.
6. Keep all shared-state mutation and final merge ownership serialized.
7. Make unsafe or uneconomic concurrency mechanically fall back to composite or
   serial execution.

### 3.2 Non-goals

- maximizing the number of simultaneously running agents;
- allowing arbitrary concurrent edits followed by best-effort conflict
  resolution;
- batching learning tasks whose successor selection depends on their ABSORB;
- permitting an in-flight run to change its own active runtime generation;
- combining unrelated tasks merely to reduce the milestone count;
- replacing independent acceptance audit with a single aggregate opinion;
- making partial Land the default for a failed composite milestone;
- treating a clean textual merge as proof of semantic compatibility.

## 4. Terms and task relationship model

| Term | Meaning |
|---|---|
| **Task** | Canonical work item with its own AC, DoD, status, and provenance |
| **Milestone** | Prepared, audited, landable execution transaction containing one or more tasks |
| **Composite milestone** | One milestone whose Plan covers multiple strongly cohesive tasks |
| **Task coupling graph** | Graph whose nodes are tasks and whose edges describe dependency, shared paths, shared symbols, semantic resources, and integration cost |
| **Semantic resource** | Protocol, schema, command namespace, state machine, runtime generation, ledger, authority boundary, or other shared meaning not captured by file paths |
| **Overlap batch** | Concurrent milestones with declared, bounded overlap |
| **MergePlan** | Checked pre-dispatch contract assigning ownership of shared surfaces and defining integration order/tests/budget |
| **Integration owner** | The only actor allowed to combine overlap-batch task commits and resolve declared intersections |
| **Fan-in owner** | The only actor allowed to merge integrated results and mutate global milestone state |
| **Integration tax** | Merge resolution, combined testing, audit expansion, contention, and expected rework caused by concurrency |

SELECT operates on two levels:

```ts
interface TaskCandidate {
  taskId: string
  valueType: string
  estimatedValue: number
  touches: string[]
  semanticResources: string[]
  dependencies: Dependency[]
  acceptanceCount: number
  estimatedLines: number
  verificationClass: string
}

interface MilestoneCandidate {
  candidateId: string
  taskIds: string[]
  deliveryHypothesis: string
  phaseGraph: Phase[]
  semanticResources: string[]
  unionValue: number
  estimatedCriticalPath: number
  estimatedFixedCostSaving: number
  estimatedCoordinationCost: number
  estimatedFailureCost: number
  verificationBoundary: "same-generation" | "next-generation"
  landPolicy: "atomic"
}
```

The selected output is a `MilestonePortfolio`: a non-overlapping set of
milestone candidates that respects dependency, cadence, concurrency, and
resource constraints.

### 4.1 Overlap classes

| Class | Definition | Default policy |
|---|---|---|
| **O0** | File and semantic resources disjoint | Concurrent |
| **O1** | Same file, different declared symbols/regions; independent behavior | Planned-overlap concurrent |
| **O2** | Same module or API family; behavior related but ownership separable | Composite preferred; experimental overlap only with human approval |
| **O3** | Same symbol, schema, protocol rule, or state transition | Composite or serial |
| **O4** | Active workflow, audit root, activation mechanism, shared ledger/counter, mission or authority boundary | Serial and generation-canary-first |

Classification must use checked Plans and source inspection. Task-level
`## Touches` remains an early, conservative pre-screen; it is not sufficient
evidence for O1 admission.

## 5. Composite milestone design

### 5.1 Admission

Tasks should be packed into one milestone when all of the following hold:

1. they share a user-visible delivery objective or implementation skeleton;
2. their dependency relationship is known;
3. the combined Plan remains understandable and bounded;
4. every AC can be mapped to a task-specific or shared phase;
5. the combined audit can still return an independent verdict per task;
6. no task requires evidence produced only after another task has independently
   landed and activated;
7. packing has positive expected value after accounting for expanded failure
   scope.

There is no maximum task count. A composite is mechanically admissible only
when:

- its positive-coupling subgraph is connected;
- every added task has positive marginal contribution after coordination and
  failure costs;
- its phase graph is acyclic;
- all ACs map to phases and audit shards;
- it contains no internal `proof-after-land`, next-generation,
  result-dependent-selection, or learning-feedback edge;
- its checked phase/stage plan satisfies the normal milestone ceiling rules;
- its critical path, context package, audit plan, and resource demand fit the
  configured milestone capacity;
- atomic rollback remains credible.

This permits a wide composite of small homogeneous tasks while rejecting even
a two-task group whose temporal proof dependency crosses a Land or runtime
generation boundary.

### 5.2 Composite charter and Plan

The charter must retain every task as a first-class unit and declare the shared
delivery contract. The checked Plan should have a machine-readable projection
equivalent to:

```yaml
milestone: Mxxx
tasks:
  DIR-101:
    acceptance: [AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8]
    phases: [schema-red, store-defaults, cli-mcp-wiring, schema-green]
  DIR-105:
    acceptance: [AC1, AC2, AC3, AC4, AC5]
    phases: [status-red, store-defaults, init-template, status-green]
shared_phases:
  - store-defaults
  - task-creation-regression
semantic_resources:
  - task-creation-default-resolution
land_policy: atomic
```

The preparation gate must prove:

- every task AC maps to at least one phase;
- every phase maps back to one or more task ACs or an explicit integration
  invariant;
- shared phases and semantic resources are declared;
- the computed touch set is no smaller than the union of all task touch sets;
- task dependency order contains no cycle;
- the Plan and inspected source hashes match the preparation receipt.

Task count does not determine agent count. The checked Plan partitions work
into execution phases and audit shards. One shared phase may satisfy several
tasks; one audit shard may cover several homogeneous tasks while still
returning a verdict for every task and AC.

### 5.3 Phase DAG

A composite milestone is not a loop that runs a complete workflow once per
task. Its execution shape is:

```text
Bundle Verify
      │
      ├── Task A RED / private implementation ─┐
      │                                        ├── Shared implementation
      └── Task B RED / private implementation ─┘
                                               │
                                         Integration
                                               │
                          Per-task Audit + Bundle Audit
                                               │
                           Per-task Gates + Bundle Gate
                                               │
                                      Transactional Land
```

Independent task-private phases may run concurrently within the resource
budget. A shared phase has one owner. No task-private worker may independently
rewrite a shared phase after integration begins.

### 5.4 Audit contract

The acceptance audit must return a verdict matrix:

```json
{
  "tasks": {
    "DIR-101": {"verdict": "PASS", "ac": {"AC1": "PASS"}},
    "DIR-105": {"verdict": "PASS", "ac": {"AC1": "PASS"}}
  },
  "integration": {
    "verdict": "PASS",
    "invariants": ["explicit-default-wins", "creation-only-defaults"]
  },
  "bundleVerdict": "PASS"
}
```

The bundle passes only if:

- every task passes its own acceptance contract;
- all shared/integration invariants pass;
- mechanical gates pass for each task and the bundle;
- the audit observes the integrated candidate, not isolated task branches;
- audit independence and generation identity are proven.

### 5.5 Land and partial failure

Build should preserve:

- one commit or savepoint per task-private change;
- one or more explicit shared-phase commits;
- one integration commit;
- a manifest mapping commits and evidence to task IDs.

The default Land policy is atomic. If one task is refuted, the bundle does not
land.

Partial Land is allowed only after a new preparation/audit pass proves that:

1. the passing task's commits are separable;
2. shared-phase changes do not depend on the failed task;
3. the reduced milestone has a regenerated charter/Plan/receipt;
4. focused and full tests pass on the reduced candidate;
5. the audit issues a new verdict for the reduced integrated state.

This is a recovery path, not an implicit checkbox operation.

## 6. Planned-overlap concurrency

### 6.1 Admission

An overlap batch may be dispatched only when:

- every task has a checked Plan and complete touch set;
- overlap is O1, or explicitly approved O2 during the experimental stage;
- no semantic-resource conflict is undeclared;
- a checked MergePlan exists;
- expected net benefit exceeds the configured threshold;
- the batch fits global agent, CPU, memory, and test-worker budgets;
- all milestones use the same immutable runtime generation;
- none edits or activates that generation;
- integration and fan-in owners are assigned before dispatch.

### 6.2 MergePlan

The MergePlan must include:

```yaml
batch: Bxxx
base_revision: <sha>
runtime_generation: <content-id>
shared_files:
  packages/quay/bin/quay.ts:
    owner: integration
    task_boundaries:
      DIR-099: [configValidateCommand]
      DIR-104: [gateListVerboseOptions]
expected_overlapping_symbols: []
application_order: [DIR-099, DIR-104]
integration_tests:
  - config validate remains independently callable
  - gate --list --verbose preserves existing output
  - global CLI help exposes both commands
conflict_budget:
  shared_files: 1
  unexpected_overlapping_symbols: 0
  resolution_minutes: 8
```

An unexpected shared symbol, semantic resource, or generated artifact is an
admission-contract failure. The integration owner stops and reclassifies the
work; it does not improvise an architecture under merge pressure.

### 6.3 Execution and integration

1. Pin all candidates to one base revision and runtime generation.
2. Run each milestone in a separate worktree.
3. Return task commits, touched-file evidence, test evidence, and audit inputs;
   do not merge to the main branch.
4. Recompute actual touch and symbol overlap before integration.
5. Apply commits in the declared order.
6. Resolve only declared O1 intersections.
7. Run focused task tests, declared integration tests, and the full applicable
   suite on the integrated candidate.
8. Run the independent acceptance audit against the integrated candidate.
9. Perform anti-drift and wiring/generation checks.
10. Let the serial fan-in owner land passing candidates and write shared state.

An isolated-task audit may be retained as diagnostic evidence, but it cannot
authorize Land because it did not observe the final integrated state.

## 7. Scheduling algorithm

### 7.1 SELECT owns composite synthesis

Composite formation must not run as a separate pass before or after SELECT.

- Pre-SELECT grouping would silently make the most important selection
  decisions—membership, excluded alternatives, value aggregation, and failure
  scope—before SELECT.
- Post-SELECT grouping would only see the already-truncated task list. A
  six-task composite could never be discovered if `concurrency=4` caused the
  old selector to retain only four tasks.

SELECT becomes a staged, feedback-bearing operation:

```text
S0 eligible task pool
  → S1 task-fact enrichment
  → S2 coupling graph
  → S3 singleton + composite candidate synthesis
  → S4 milestone-portfolio scoring and provisional choice
  → S5 prepare chosen milestone candidates
  → S6 recompute facts and reselect on preparation drift
  → S7 commit final selection and dispatch
```

`candidate_horizon` and execution `concurrency` are independent. Concurrency
limits simultaneously executing milestones; it must not truncate the task
facts available to composite synthesis. The candidate horizon starts from
ranked seeds and expands through strong-coupling and dependency neighbors, even
when those neighbors fall below the initial rank window.

### 7.2 Construct the coupling graph

For every prepared candidate pair, compute an edge with:

```text
dependency:
  none | internal-order | proof-after-land | result-dependent | cyclic/unknown

path overlap:
  files, globs, generated outputs

symbol overlap:
  modules, declarations, functions, command registrations

semantic overlap:
  schemas, protocols, state machines, runtime/control-plane resources

estimated integration:
  minutes, tests, reviewer/auditor expansion
```

Edges also record positive coupling (`same-deliverable`,
`shared-implementation`, `shared-semantic-resource`) and prohibitive temporal
coupling (`proof-after-land`, next-generation proof, or a learning result that
changes whether another task should be selected).

### 7.3 Synthesize milestone candidates

The candidate set always contains every eligible singleton plus a bounded set
of connected composite candidates. Do not enumerate the power set. Use
seeded/agglomerative or beam-search expansion:

1. start with high-ranked singleton seeds;
2. expand along positive coupling edges;
3. include required dependency closure;
4. prune prohibitive temporal edges, cycles, disconnected additions, and
   negative marginal contribution;
5. retain the best K distinct shapes per seed;
6. preserve singletons as the no-packing control.

For group `G` and prospective task `t`, admit the expansion only when:

```text
marginal_value(t | G)
  + fixed_cost_saved(t | G)
  + shared_context_saved(t | G)
>
coordination_cost(t | G)
  + expanded_failure_cost(t | G)
  + critical_path_penalty(t | G)
```

The value term is a union value, not a naïve sum; two tasks claiming the same
delivery improvement must not double-count it.

### 7.4 Choose a milestone portfolio

In rank order:

1. Extract O4 and learning/dependency-chain work into the serial canary lane.
2. Score singleton and synthesized composite milestone candidates together.
3. Choose a non-overlapping set: one task may occur in at most one selected
   milestone candidate.
4. Admit O0 milestone candidates to ordinary disjoint batches.
5. Consider O1 edges between milestone candidates for planned-overlap batches
   if their expected net benefit
   is positive and the resource budget permits.
6. Defer remaining candidates rather than weakening admission.

The portfolio objective accounts for union delivery value, wall-clock critical
path, cadence, resource demand, integration tax, and atomic failure cost. The
first implementation may use deterministic beam search plus weighted set
packing rather than a general optimizer. It must record selected and rejected
candidate shapes so policy can be calibrated from real outcomes.

### 7.5 Preparation feedback

Task-level facts are intentionally cheap and conservative. Checked preparation
may discover new touched paths, semantic resources, dependencies, or scope.
Preparation therefore validates a provisional selection rather than merely
decorating it.

If checked facts change candidate membership or portfolio compatibility, return
to candidate synthesis and reselect. Permit at most three preparation/reselect
rounds. A group that does not stabilize is split or routed to human review; it
is never dispatched using stale pre-preparation facts.

### 7.6 Economic admission

For candidate tasks \(i\):

```text
serial_cost       = Σ workflow_duration_i
parallel_path     = max(workflow_duration_i)
integration_tax   = merge + integration_tests + expanded_audit + contention
expected_rework   = P(failure_or_conflict) × recovery_cost

expected_saving   =
  serial_cost - parallel_path - integration_tax - expected_rework
```

Admit planned overlap only if:

```text
expected_saving >= max(10 minutes, 20% of serial_cost)
```

Safety constraints remain hard gates even when the economic result is
positive.

For composite packing, compare:

```text
packing_saving =
  separate_serial_cost
  - composite_duration
  - expanded_failure_scope_cost
```

Historical estimates initialize the model; observed data replaces estimates
after every batch.

## 8. Quantitative expectations

### 8.1 Composite milestone

Two representative 28.5-minute workflows cost about 57 minutes serially.
Reusing Verify/setup, sharing implementation context, combining mechanical
checks, and landing once is expected to produce a 38–43 minute two-task
composite:

```text
estimated saving: 14–19 minutes
estimated speedup: 1.3–1.5×
```

Three cohesive tasks may reduce approximately 85 minutes to 50–60 minutes, but
the larger failure domain does not justify starting at that width.

### 8.2 O1 overlap batch

Two 28-minute tasks with an 8-minute integration pass and a 10% probability of
20 minutes of recovery cost yield:

```text
serial:             56 minutes
parallel path:      28 minutes
integration:         8 minutes
expected rework:     2 minutes
expected total:     38 minutes
expected saving:    18 minutes
speedup:          ~1.47×
```

For an O2 pair with 15 minutes of integration and 30% probability of a
25-minute recovery:

```text
expected total:   28 + 15 + 7.5 = 50.5 minutes
expected saving:  5.5 minutes
speedup:          ~1.11×
```

The O2 example does not clear the proposed admission threshold and should be
packed or serialized.

### 8.3 Portfolio expectation

Disjoint three-wide batches previously showed a theoretical 2.1–2.4× batch
speedup, but retries, proof closure, serial fan-in, and dependency chains reduce
whole-stream improvement to roughly 1.3–1.5×.

Adaptive packing and O1 overlap admission may raise sustained task throughput
to approximately 1.5–1.8× the current serial baseline. This is a hypothesis to
test, not a delivery commitment.

## 9. Safety and resource invariants

1. **Generation-pinned:** every batch records one immutable runtime generation.
2. **Canary-first:** a generation that changes workflow/audit/gate semantics
   must prove one bounded real run before wider use.
3. **No shared Land:** task workers never merge into the main branch.
4. **One integration owner:** only it resolves declared overlap.
5. **One fan-in owner:** only it mutates dashboard, backlog, counters, ABSORB,
   activation, or other shared lifecycle state.
6. **Integrated-state audit:** Land requires an audit of the final candidate.
7. **Per-task truth:** packing never erases task-specific AC, verdict, status,
   evidence, or provenance.
8. **Unexpected-overlap stop:** undeclared symbol/semantic overlap forces
   reclassification.
9. **No learning batch:** learning and successor-selection dependencies remain
   serial.
10. **Bounded resources:** milestone width, agent fan-out, and test concurrency
    share a global budget.

Initial resource envelope:

```yaml
max_concurrent_milestones: 2
max_overlap_class: O1
max_shared_files_per_overlap_batch: 2
max_unexpected_shared_symbols: 0
max_agent_fanout: 8
test_concurrency_per_milestone: 4
candidate_seed_horizon: 12
candidate_shapes_per_seed: 4
max_prepare_reselect_rounds: 3
```

There is deliberately no `max_composite_tasks`. A capacity check instead
validates phase-DAG structure, estimated critical path, line/context budget,
audit-shard budget, resource demand, temporal proof boundaries, and atomic
rollback. The effective task count and concurrent width may both be lower or
higher than historical examples.

## 10. Metrics and observability

Milestone count is no longer a sufficient throughput measure once a milestone
may contain multiple tasks. Record:

- completed tasks and completed ACs;
- task and milestone lead time;
- phase duration and critical path;
- bundle size;
- overlap class;
- estimated versus actual integration minutes;
- textual conflicts and semantic conflicts;
- focused/full-suite contention or flake rate;
- audit findings per task and per integration;
- partial-failure and full-rollback rates;
- re-preparation and re-audit time;
- expected versus realized saving;
- runtime generation and canary status.

Primary success measures:

```text
completed tasks / wall-clock development hour
p50 and p90 task lead time
rework minutes / completed task
integration-tax minutes / overlap batch
```

A speedup accompanied by a material increase in escaped wiring errors, audit
refutations, or generation ambiguity is a failed experiment.

## 11. Candidate pilot mappings

### 11.1 Composite fixtures and historical replay

`DIR-101` and `DIR-105` are a plausible composite:

- both change task-creation defaults;
- both touch `store.ts` and `quay-native.ts`;
- both require default precedence and creation-only behavior tests;
- their combined integration semantics are more important than their textual
  merge.

This two-task case remains a useful compatibility fixture: one “task creation
defaults” milestone can share
source exploration, RED setup, default-resolution implementation, regression
testing, audit, and Land while retaining two task verdicts.

It is not sufficient as the real proof. Historical replay must additionally
cover:

- `DIR-114` + `gap-absorb-charter-audit-not-committed` + `DIR-115`, which should
  form a three-task workflow-hardening candidate;
- `DIR-109`–`DIR-112`, for which SELECT should generate and compare several
  singleton and composite shapes rather than force one grouping;
- `DIR-062-B`→`DIR-062-C`, which must remain separated by its
  next-generation/proof boundary;
- a wide homogeneous lifecycle-reconciliation fixture, proving that task count
  alone does not reject a valid composite.

### 11.2 O1 overlap pilot

`DIR-099` and `DIR-104` are a plausible planned-overlap pair:

- both touch `packages/quay/bin/quay.ts`;
- they add different CLI behaviors;
- expected shared work is command registration/import integration rather than
  common business semantics.

Source inspection during preparation must confirm separate symbol ownership
before O1 admission.

### 11.3 Independent companion

`DIR-100`, which is scoped to the gate loader and a new diagnostics test, is a
plausible ordinary O0 concurrent candidate.

### 11.4 Serial generation chain

`DIR-117` and `DIR-118` both modify milestone workflows, OUTER-LOOP policy, and
proof mechanics. They are O4 and must not be used as overlap pilots. Their
relationship is an example of generation-ordered work:

```text
prepare-milestone generation
    → canary/proof
    → next-generation wiring lifecycle
    → canary/proof
```

## 12. Rollout

### Stage 0 — measurement and contracts

- Add no concurrency.
- Define machine-readable coupling edges, semantic resources, composite phase
  mappings, MergePlan, and outcome metrics.
- Replay recent tasks through the classifier and compare its recommendation
  with observed rework.

Exit condition: deterministic classification fixtures cover O0–O4 and reject
missing/ambiguous ownership.

### Stage 1 — SELECT candidate synthesis

- Change SELECT's output from tasks to a milestone portfolio.
- Add task facts, coupling edges, singleton/composite candidate synthesis,
  group scoring, non-overlapping portfolio choice, and preparation feedback.
- Golden-replay the historical cases in §11.1.

Exit condition: deterministic replay produces the expected grouping and
separation decisions, including a composite wider than two tasks.

### Stage 2 — arbitrary-width composite execution

- Extend preparation and execution contracts to support arbitrary non-empty
  `taskIds[]`.
- Execute a checked phase DAG and audit-shard plan; task count must not map
  one-for-one to agent count.
- Require per-task and bundle verdicts, deterministic reconcile, atomic Land,
  full provenance, and backward-compatible singleton execution.

Exit condition: fixtures with 1, 3, 5, and 10 tasks behave correctly; invalid
capacity and temporal-dependency cases fail closed.

### Stage 3 — real SELECT→composite canary

- Cold-start a new runtime generation.
- Let real SELECT synthesize and choose a composite of at least three real
  tasks; do not hand-inject the membership after selection.
- Run preparation, execution, audit, reconcile, atomic Land, and wiring audit.

Exit condition: one real ≥3-task composite lands with correct task provenance,
one milestone counter increment, durable selection alternatives, and
next-generation wiring evidence. If no admissible real group exists, remain
awaiting proof rather than force an incoherent bundle.

### Stage 4 — planned-overlap concurrency

- Add checked MergePlan and integration-owner mechanics.
- Run one two-milestone O1 batch in isolated worktrees.
- Stop on any undeclared shared symbol.
- Audit only the final integrated candidate for Land.
- Recalibrate estimates from observed outcomes before autonomous O1 admission.

No stage transition is justified solely by elapsed time or demand for higher
throughput.

## 13. Acceptance criteria for an implementation directive

Any directive adopting this proposal should require at least:

1. A checked composite Plan maps every task AC to a phase and every shared
   phase to an integration invariant.
2. `execute-milestone` accepts arbitrary non-empty task-ID arrays without
   losing compatibility with one-task milestones and without a cardinality
   hard cap.
3. Audit returns mechanically validated per-task and bundle verdicts.
4. Atomic Land writes correct provenance and lifecycle status for every task.
5. Partial Land fails closed unless the reduced bundle is re-prepared and
   re-audited.
6. Coupling classification distinguishes file, symbol, semantic-resource, and
   generation overlap.
7. O1 dispatch requires a checked MergePlan with ownership, integration tests,
   application order, and conflict budget.
8. Unexpected overlap stops integration before main-branch mutation.
9. All shared lifecycle writes remain fan-in-only.
10. The final audit observes the integrated candidate.
11. Resource budgets bound milestone, agent, and test concurrency.
12. Historical replay proves a three-task cluster is formed, a temporal-proof
    pair is split, and a wide homogeneous group is not rejected for cardinality.
13. One real composite of at least three tasks is synthesized by SELECT—not
    manually injected after SELECT—and lands with durable evidence and
    serial-equivalence checks.
14. Metrics report expected and realized savings, integration tax, rework, and
    defect outcomes.
15. A next-generation run proves the installed workflow is actually wired;
    source-only tests are insufficient.

## 14. Open questions

1. What deterministic beam width and candidate seed horizon balance decision
   quality against authoring cost?
2. Should task commits be mandatory savepoints, or is a machine-readable
   task-to-diff manifest sufficient?
3. Which parser or language service should provide symbol overlap without
   making admission language-specific?
4. Should O2 ever become autonomous, or remain an explicit human optimization?
5. What historical window should estimate conflict and rework probabilities?
6. How should union value and cadence be normalized when one composite contains
   several value types?
7. Should partial Land allocate a new milestone identity, or retain the
   original identity with a formally reduced task set?
8. How should test concurrency be allocated dynamically when suites have very
   different resource profiles?

Until these are resolved, the conservative defaults in this proposal apply:
SELECT-owned candidate synthesis, capacity-bounded rather than
cardinality-bounded composites, two concurrent milestones, O1 maximum, atomic
Land, and generation-canary-first.

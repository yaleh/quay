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

The scheduler should first construct a **task coupling graph**, then choose
milestone boundaries and concurrency. It must not treat the task documents as
preordained execution units.

The initial rollout should support at most:

- two tasks in a composite milestone;
- two concurrent milestones in a planned-overlap batch;
- overlap class O1 only (same file, different owned symbols or regions);
- one active integration owner and one serial fan-in owner;
- one canary milestone per new runtime generation before wider dispatch.

Concurrency remains an optimization, never a relaxation of acceptance,
independent audit, generation identity, or landing proof.

## 2. Problem statement

### 2.1 A task is not always the right execution transaction

The current `execute-milestone` contract takes one `taskId`. Verify, Build,
Audit, Gate, provenance write-back, dashboard update, and Land all assume a
one-task milestone.

That boundary is appropriate for independent work, but inefficient when two
tasks:

- change the same implementation skeleton;
- require the same repository exploration and test setup;
- expose two aspects of one user-visible capability;
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

Initial mechanical limits:

- maximum two tasks;
- maximum one shared semantic core;
- no O4 work;
- no task already marked learning-type;
- no unresolved AC or dependency contradiction;
- no combined touch/line/complexity budget above the normal
  SPLIT-OR-COMMIT ceiling.

### 5.2 Composite charter and Plan

The charter must retain each task as a first-class unit and declare the shared
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

### 7.1 Construct the coupling graph

For every prepared candidate pair, compute an edge with:

```text
dependency:
  none | A-before-B | B-before-A | cyclic/unknown

path overlap:
  files, globs, generated outputs

symbol overlap:
  modules, declarations, functions, command registrations

semantic overlap:
  schemas, protocols, state machines, runtime/control-plane resources

estimated integration:
  minutes, tests, reviewer/auditor expansion
```

### 7.2 Choose execution shape

In rank order:

1. Extract O4 and learning/dependency-chain work into the serial canary lane.
2. Cluster strongly cohesive O2/O3 nodes into bounded composite candidates.
3. Admit O0 nodes to ordinary disjoint batches.
4. Consider O1 edges for planned-overlap batches if their expected net benefit
   is positive and the resource budget permits.
5. Defer remaining nodes rather than weakening admission.

The first implementation may use deterministic rules rather than an optimizer.
The decision and all rejected alternatives must be recorded so the policy can
be calibrated from real outcomes.

### 7.3 Economic admission

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
max_composite_tasks: 2
max_overlap_class: O1
max_shared_files_per_overlap_batch: 2
max_unexpected_shared_symbols: 0
max_agent_fanout: 8
test_concurrency_per_milestone: 4
```

The effective width may be lower than the configured maximum.

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

### 11.1 Composite pilot

`DIR-101` and `DIR-105` are a plausible composite:

- both change task-creation defaults;
- both touch `store.ts` and `quay-native.ts`;
- both require default precedence and creation-only behavior tests;
- their combined integration semantics are more important than their textual
  merge.

The pilot hypothesis is that one “task creation defaults” milestone can share
source exploration, RED setup, default-resolution implementation, regression
testing, audit, and Land while retaining two task verdicts.

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

### Stage 1 — two-task composite canary

- Extend preparation and execution contracts to support `taskIds[]`.
- Run one two-task composite under halt/human steering.
- Require per-task and bundle audit verdicts, atomic Land, and full provenance.
- Replay the same tasks serially or compare against a credible serial baseline.

Exit condition: both tasks land with no lost AC/status/evidence, and measured
time is lower than the serial baseline without extra refutation.

### Stage 2 — O1 overlap canary

- Add checked MergePlan and integration-owner mechanics.
- Run one two-milestone O1 batch in isolated worktrees.
- Stop on any undeclared shared symbol.
- Audit only the final integrated candidate for Land.

Exit condition: integration stays within budget, serial replay is equivalent,
and anti-drift/generation/wiring proof passes.

### Stage 3 — adaptive two-wide operation

- Let the scheduler choose O0, composite, O1, or serial.
- Keep maximum width two and composite size two.
- Require human approval for O2.
- Recalibrate estimates from observed outcomes.

Exit condition: at least two clean composite batches and two clean O1 batches,
with positive realized saving and no increase in escaped defects.

### Stage 4 — bounded expansion

- Consider three-wide ordinary batches.
- Consider three-task composites only when task coupling and audit complexity
  remain bounded.
- Consider autonomous O1 admission.
- Keep O3/O4 composite/serial and generation-canary-first.

No stage transition is justified solely by elapsed time or demand for higher
throughput.

## 13. Acceptance criteria for an implementation directive

Any directive adopting this proposal should require at least:

1. A checked composite Plan maps every task AC to a phase and every shared
   phase to an integration invariant.
2. `execute-milestone` accepts multiple task IDs without losing compatibility
   with one-task milestones.
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
12. One real composite canary and one real O1 overlap canary land with durable
    evidence and serial-equivalence checks.
13. Metrics report expected and realized savings, integration tax, rework, and
    defect outcomes.
14. A next-generation run proves the installed workflow is actually wired;
    source-only tests are insufficient.

## 14. Open questions

1. Should composite packing be proposed by SELECT and independently approved by
   preparation, or should preparation alone own the packing decision?
2. Should task commits be mandatory savepoints, or is a machine-readable
   task-to-diff manifest sufficient?
3. Which parser or language service should provide symbol overlap without
   making admission language-specific?
4. Should O2 ever become autonomous, or remain an explicit human optimization?
5. What historical window should estimate conflict and rework probabilities?
6. How should value ranking compare one high-value composite with several
   individually ranked tasks?
7. Should partial Land allocate a new milestone identity, or retain the
   original identity with a formally reduced task set?
8. How should test concurrency be allocated dynamically when suites have very
   different resource profiles?

Until these are resolved, the conservative defaults in this proposal apply:
two tasks, two concurrent milestones, O1 maximum, atomic Land, and
generation-canary-first.
